/**
 * Administrator callables: QR token lifecycle. The raw token is returned exactly
 * once, at mint time, for printing. Firestore keeps only its hash, so a rotated
 * or leaked database cannot be used to forge table access.
 */
import {onCall} from 'firebase-functions/v2/https';
import {db, globalRefs, callableOptions, BASE_URL, FieldValue, parseInput, txOk, txFail, unwrap, type TxResult} from './runtime';
import {rotateTableQrTokenInput, type RotateTableQrTokenResult} from '../../src/lib/contracts';
import {requireAdmin, mintToken, hashToken, audit} from './security';
import type {TableDoc} from './sessions';

export const rotateTableQrToken = onCall(callableOptions, async (request): Promise<RotateTableQrTokenResult> => {
  const input = parseInput(rotateTableQrTokenInput, request.data);
  const staff = await requireAdmin(request, input.branchId);
  const refs = staff.refs;

  const token = mintToken();
  const tokenHash = hashToken(token);

  const tokenVersion = unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<number>> => {
      const snapshot = await tx.get(refs.table(input.tableId));
      if (!snapshot.exists) return txFail('not-found', 'invalid-qr', 'Table not found');
      const table = snapshot.data() as TableDoc;
      const nextVersion = (table.qrTokenVersion ?? 0) + 1;

      // Revoke rather than delete, so a scan of an old printed label is logged
      // as a replaced code instead of an unknown one.
      if (table.qrTokenHash) {
        tx.update(globalRefs.qrToken(table.qrTokenHash), {revoked: true, revokedAt: FieldValue.serverTimestamp()});
      }

      // The branch is stamped on the token because a scan supplies the hash
      // and nothing else: this field is what tells resolveTableQr which
      // branch's tables and menu to use.
      tx.set(globalRefs.qrToken(tokenHash), {
        branchId: refs.branchId,
        tableId: input.tableId,
        version: nextVersion,
        revoked: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(refs.table(input.tableId), {
        qrTokenHash: tokenHash,
        qrTokenVersion: nextVersion,
        qrRotatedAt: FieldValue.serverTimestamp(),
        qrRotatedBy: staff.uid,
      });

      audit(tx, {
        branchId: refs.branchId,
        action: 'admin.qr.rotated',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: refs.table(input.tableId).path,
        detail: {tokenVersion: nextVersion},
      });

      return txOk(nextVersion);
    }),
  );

  return {tableId: input.tableId, printableQrPayload: `${BASE_URL}/t/${token}`, tokenVersion};
});
