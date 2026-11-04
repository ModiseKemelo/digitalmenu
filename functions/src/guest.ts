/**
 * Guest-facing callables. A QR token proves only which table the guest is
 * sitting at; it never grants access to history. Every call that touches order
 * data requires a short-lived, revocable capability bound to the current
 * dining session (docs/04-SECURITY-AND-DATA.md).
 */
import {onCall} from 'firebase-functions/v2/https';
import {db, refsFor, globalRefs, fail, callableOptions, FieldValue, parseInput, txOk, txFail, unwrap, DEFAULT_BRANCH_ID, type TxResult} from './runtime';
import {
  resolveTableQrInput,
  submitGuestOrderInput,
  guestSessionViewInput,
  createServiceRequestInput,
  type ResolveTableQrResult,
  type SubmitOrderResult,
  type GuestSessionView,
  type CreateServiceRequestResult,
  type OrderStatus,
} from '../../src/lib/contracts';
import {hashToken, requireGuest, issueCapability, consumeRateLimit, scopeIdempotencyKey, readIdempotentResult, writeIdempotentResult, audit} from './security';
import {readTableSession, ensureSession, readOpenSession, applySessionTotals} from './sessions';
import {priceOrderLines} from './pricing';
import {isChargeable} from '../../src/lib/order-domain';

/**
 * Exchanges a printed QR token for the table's current session and a guest
 * capability. Returns no order or payment history.
 */
export const resolveTableQr = onCall(callableOptions, async (request): Promise<ResolveTableQrResult> => {
  const {token} = parseInput(resolveTableQrInput, request.data);

  // Blunt QR guessing before the lookup, keyed by hash so no raw token is logged.
  const tokenHash = hashToken(token);
  await consumeRateLimit(`qr:${tokenHash}`, 30, 60_000);

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<ResolveTableQrResult>> => {
      // The token lookup is the only thing that knows which branch this guest
      // is sitting in: the printed card carries a hash and nothing else.
      const tokenSnapshot = await tx.get(globalRefs.qrToken(tokenHash));
      // T02: an unknown or rotated-out token fails the same way as a disabled one.
      if (!tokenSnapshot.exists) return txFail('not-found', 'invalid-qr', 'This QR code is not valid');
      const tokenDoc = tokenSnapshot.data() as {
        branchId?: string;
        tableId: string;
        revoked: boolean;
        version: number;
      };
      if (tokenDoc.revoked) {
        return txFail('not-found', 'invalid-qr', 'This QR code has been replaced; ask staff for the current code');
      }
      // Codes minted before the branch migration belong to the original branch.
      const branchId = tokenDoc.branchId ?? DEFAULT_BRANCH_ID;
      const refs = refsFor(branchId);

      const read = await readTableSession(refs, tx, tokenDoc.tableId);
      if (!read.ok) return read;

      const {sessionId} = ensureSession(refs, tx, read.value);
      const {capability, guestId, expiresAtMs} = issueCapability(tx, {
        branchId,
        sessionId,
        tableId: tokenDoc.tableId,
      });

      audit(tx, {
        branchId,
        action: 'guest.capability.issued',
        actorType: 'guest',
        actorId: guestId,
        targetPath: refs.session(sessionId).path,
        detail: {tableId: tokenDoc.tableId, tokenVersion: tokenDoc.version},
      });

      return txOk({tableLabel: read.value.table.label, sessionId, capability, capabilityExpiresAt: expiresAtMs});
    }),
  );
});

/**
 * Submits a guest order. Prices are resolved server-side and the whole write is
 * one transaction keyed by an idempotency key, so a retry after a dropped
 * response returns the original order instead of creating a second one (T05),
 * while two different guests at one table create two distinct orders (T04).
 */
export const submitGuestOrder = onCall(callableOptions, async (request): Promise<SubmitOrderResult> => {
  const input = parseInput(submitGuestOrderInput, request.data);
  const guest = await requireGuest(input.capability);
  const refs = guest.refs;
  await consumeRateLimit(`order:${guest.guestId}`, 20, 60_000);

  const scopedKey = scopeIdempotencyKey('submitGuestOrder', guest.sessionId, input.idempotencyKey);

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<SubmitOrderResult>> => {
      const replayed = await readIdempotentResult<SubmitOrderResult>(tx, scopedKey);
      if (replayed) return txOk(replayed);

      const sessionRead = await readOpenSession(refs, tx, guest.sessionId);
      if (!sessionRead.ok) return sessionRead;
      const session = sessionRead.value;

      const priced = await priceOrderLines(refs, tx, input.items);
      if (!priced.ok) return priced;
      const {items, totalMinor} = priced.value;

      const orderRef = refs.orders(guest.sessionId).doc();
      const status: OrderStatus = 'received';
      tx.set(orderRef, {
        restaurantId: refs.branchId,
        sessionId: guest.sessionId,
        tableId: guest.tableId,
        source: 'guest',
        guestId: guest.guestId,
        staffUid: null,
        status,
        items,
        totalMinor,
        version: 0,
        statusHistory: [{status, at: new Date(), actorType: 'guest', actorId: guest.guestId}],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      applySessionTotals(refs, tx, guest.sessionId, {
        chargeTotalMinor: session.chargeTotalMinor + totalMinor,
        paidMinor: session.paidMinor,
        adjustmentsMinor: session.adjustmentsMinor,
      });

      const result: SubmitOrderResult = {orderId: orderRef.id, status, totalMinor};
      writeIdempotentResult(tx, scopedKey, 'submitGuestOrder', result);
      audit(tx, {
        branchId: refs.branchId,
        action: 'guest.order.submitted',
        actorType: 'guest',
        actorId: guest.guestId,
        targetPath: orderRef.path,
        detail: {totalMinor, lineCount: items.length},
      });

      return txOk(result);
    }),
  );
});

/**
 * The guest's own view of the current session. Scoped to the orders this
 * capability submitted, so one party member cannot read another table or a
 * previous party (T08, T12).
 */
export const getGuestSessionView = onCall(callableOptions, async (request): Promise<GuestSessionView> => {
  const {capability} = parseInput(guestSessionViewInput, request.data);
  const guest = await requireGuest(capability);
  const refs = guest.refs;

  const [sessionSnapshot, orderSnapshots] = await Promise.all([
    refs.session(guest.sessionId).get(),
    refs.orders(guest.sessionId).where('guestId', '==', guest.guestId).orderBy('createdAt', 'desc').limit(50).get(),
  ]);
  if (!sessionSnapshot.exists) fail('not-found', 'session-closed', 'Dining session not found');
  const sessionDoc = sessionSnapshot.data() as {tableLabel: string; chargeTotalMinor?: number};

  const orders = orderSnapshots.docs.map((doc) => {
    const data = doc.data() as {
      status: OrderStatus;
      totalMinor: number;
      createdAt: {toMillis(): number} | null;
      items: {name: string; quantity: number; lineTotalMinor: number; notes: string}[];
    };
    return {
      orderId: doc.id,
      status: data.status,
      totalMinor: data.totalMinor,
      createdAt: data.createdAt?.toMillis() ?? 0,
      items: data.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor,
        notes: item.notes,
      })),
    };
  });

  return {
    tableLabel: sessionDoc.tableLabel,
    sessionId: guest.sessionId,
    orders,
    ownTotalMinor: orders.filter((order) => isChargeable(order.status)).reduce((sum, order) => sum + order.totalMinor, 0),
    // Whether the *table* owes anything, as a flag rather than an amount: it
    // tells the client whether asking for the bill is possible without
    // revealing what the rest of the party has spent.
    tableHasChargeableOrders: (sessionDoc.chargeTotalMinor ?? 0) > 0,
  };
});

/** Asks for the bill or for assistance. Rate limited so it cannot be spammed. */
export const createServiceRequest = onCall(callableOptions, async (request): Promise<CreateServiceRequestResult> => {
  const input = parseInput(createServiceRequestInput, request.data);
  const guest = await requireGuest(input.capability);
  const refs = guest.refs;
  await consumeRateLimit(`service:${guest.guestId}:${input.type}`, 3, 5 * 60_000);

  // There is nothing to settle until the table owes something, so a bill
  // request against a zero charge total is refused: it would otherwise send a
  // waiter to print a P0.00 bill. `chargeTotalMinor` is the table's figure, not
  // this guest's, because any one guest may legitimately ask for the whole
  // table's bill; it is maintained by submitGuestOrder and by cancellation, so
  // a table whose only order was cancelled is back to zero. Assistance is
  // always allowed — a guest who has ordered nothing is exactly who needs it.
  if (input.type === 'bill') {
    const sessionSnapshot = await refs.session(guest.sessionId).get();
    if (!sessionSnapshot.exists) fail('not-found', 'session-closed', 'Dining session not found');
    const session = sessionSnapshot.data() as {status: string; chargeTotalMinor?: number};
    if (session.status !== 'open') fail('failed-precondition', 'session-closed', 'This table has been closed');
    if ((session.chargeTotalMinor ?? 0) <= 0) {
      fail(
        'failed-precondition',
        'nothing-to-bill',
        'There is nothing on this table’s bill yet. Order something first, or call a waiter for help.',
      );
    }
  }

  const ref = refs.serviceRequests().doc();
  await ref.set({
    restaurantId: refs.branchId,
    sessionId: guest.sessionId,
    tableId: guest.tableId,
    guestId: guest.guestId,
    type: input.type,
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
    resolvedAt: null,
    resolvedBy: null,
  });

  return {requestId: ref.id};
});
