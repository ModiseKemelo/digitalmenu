/**
 * Dining session lifecycle. The core invariant is one open session per table,
 * maintained transactionally so two guests scanning at the same moment join one
 * session rather than creating two.
 */
import type {Transaction} from 'firebase-admin/firestore';
import {refs, FieldValue, Timestamp, txOk, txFail, type TxResult, type SessionDoc} from './runtime';
import {sessionBalance} from '../../src/lib/order-domain';

export type TableDoc = {
  label: string;
  enabled: boolean;
  activeSessionId: string | null;
  qrTokenHash: string;
  qrTokenVersion: number;
};

/**
 * Read phase of table/session resolution.
 *
 * Firestore requires every read in a transaction to precede every write, so
 * reading and creating a session are deliberately two calls: callers that must
 * read more (menu prices, idempotency records) do so between the two.
 */
export type TableSessionRead = {
  tableId: string;
  table: TableDoc;
  sessionId: string | null;
  session: SessionDoc | null;
};

export async function readTableSession(tx: Transaction, tableId: string): Promise<TxResult<TableSessionRead>> {
  const tableSnapshot = await tx.get(refs.table(tableId));
  if (!tableSnapshot.exists) return txFail('not-found', 'invalid-qr', 'Table not found');
  const table = tableSnapshot.data() as TableDoc;
  if (table.enabled !== true) {
    return txFail('failed-precondition', 'table-disabled', 'This table is not currently in service');
  }

  if (table.activeSessionId) {
    const existing = await tx.get(refs.session(table.activeSessionId));
    const session = existing.exists ? (existing.data() as SessionDoc) : null;
    // A table pointing at a closed or missing session is stale state; the write
    // phase opens a fresh one.
    if (session && session.status === 'open') {
      return txOk({tableId, table, sessionId: table.activeSessionId, session});
    }
  }

  return txOk({tableId, table, sessionId: null, session: null});
}

/**
 * Write phase: returns the table's open session, creating one if the table is
 * idle. This is where the one-open-session-per-table invariant is enforced —
 * two guests scanning at the same instant contend on the table document, so one
 * transaction retries and both end up in a single session.
 */
export function ensureSession(
  tx: Transaction,
  read: TableSessionRead,
): {sessionId: string; session: SessionDoc} {
  if (read.sessionId && read.session) return {sessionId: read.sessionId, session: read.session};

  const sessionRef = refs.sessions().doc();
  const session: SessionDoc = {
    tableId: read.tableId,
    tableLabel: read.table.label,
    status: 'open',
    openedAt: Timestamp.now(),
    closedAt: null,
    chargeTotalMinor: 0,
    paidMinor: 0,
    adjustmentsMinor: 0,
    balanceMinor: 0,
    version: 0,
  };
  tx.set(sessionRef, {...session, restaurantId: refs.restaurant().id, openedAt: FieldValue.serverTimestamp()});
  tx.update(refs.table(read.tableId), {
    activeSessionId: sessionRef.id,
    lastSessionOpenedAt: FieldValue.serverTimestamp(),
  });

  return {sessionId: sessionRef.id, session};
}

export async function readOpenSession(tx: Transaction, sessionId: string): Promise<TxResult<SessionDoc>> {
  const snapshot = await tx.get(refs.session(sessionId));
  if (!snapshot.exists) return txFail('not-found', 'session-closed', 'Dining session not found');
  const session = snapshot.data() as SessionDoc;
  if (session.status !== 'open') return txFail('failed-precondition', 'session-closed', 'This table has been closed');
  return txOk(session);
}

/**
 * Recomputes and writes the session money fields. Balance is always derived,
 * never sent by a client.
 */
export function applySessionTotals(
  tx: Transaction,
  sessionId: string,
  totals: {chargeTotalMinor: number; paidMinor: number; adjustmentsMinor: number},
): number {
  const balanceMinor = sessionBalance(totals);
  tx.update(refs.session(sessionId), {
    chargeTotalMinor: totals.chargeTotalMinor,
    paidMinor: totals.paidMinor,
    adjustmentsMinor: totals.adjustmentsMinor,
    balanceMinor,
    updatedAt: FieldValue.serverTimestamp(),
    version: FieldValue.increment(1),
  });
  return balanceMinor;
}

/** Revokes every guest capability for a session, so a reset table drops access. */
export async function revokeSessionCapabilities(tx: Transaction, sessionId: string): Promise<void> {
  const capabilities = await tx.get(
    refs.restaurant().collection('guestCapabilities').where('sessionId', '==', sessionId).where('revoked', '==', false),
  );
  for (const doc of capabilities.docs) {
    tx.update(doc.ref, {revoked: true, revokedAt: FieldValue.serverTimestamp()});
  }
}

export {Timestamp};
