/**
 * Staff callables. Every one re-reads the staff document, so role changes and
 * deactivation take effect immediately. Money writes are append-only and
 * audited; balances are always derived server-side (docs/04).
 */
import {onCall} from 'firebase-functions/v2/https';
import {db, refs, callableOptions, FieldValue, Timestamp, parseInput, txOk, txFail, unwrap, type TxResult} from './runtime';
import {
  submitWaiterOrderInput,
  updateOrderStatusInput,
  recordManualPaymentInput,
  reverseManualPaymentInput,
  closeDiningSessionInput,
  type SubmitOrderResult,
  type UpdateOrderStatusResult,
  type RecordManualPaymentResult,
  type ReverseManualPaymentResult,
  type CloseDiningSessionResult,
  type OrderStatus,
  type PaymentMethod,
} from '../../src/lib/contracts';
import {requireStaff, requireAdmin, scopeIdempotencyKey, readIdempotentResult, writeIdempotentResult, audit} from './security';
import {readTableSession, ensureSession, readOpenSession, applySessionTotals, revokeSessionCapabilities} from './sessions';
import {priceOrderLines} from './pricing';
import {canRoleTransition, isChargeable, isSettled} from '../../src/lib/order-domain';

/** An assisted order a waiter takes at the table on the guest's behalf. */
export const submitWaiterOrder = onCall(callableOptions, async (request): Promise<SubmitOrderResult> => {
  const input = parseInput(submitWaiterOrderInput, request.data);
  const staff = await requireStaff(request);
  const scopedKey = scopeIdempotencyKey('submitWaiterOrder', input.tableId, input.idempotencyKey);

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<SubmitOrderResult>> => {
      const replayed = await readIdempotentResult<SubmitOrderResult>(tx, scopedKey);
      if (replayed) return txOk(replayed);

      // Every read first: the table, its session and the menu prices. Opening a
      // session is a write, so it cannot happen before the pricing reads.
      const read = await readTableSession(tx, input.tableId);
      if (!read.ok) return read;
      const priced = await priceOrderLines(tx, input.items);
      if (!priced.ok) return priced;
      const {items, totalMinor} = priced.value;
      const {sessionId, session} = ensureSession(tx, read.value);

      const orderRef = refs.orders(sessionId).doc();
      // A waiter taking the order has already acknowledged it.
      const status: OrderStatus = 'accepted';
      tx.set(orderRef, {
        restaurantId: refs.restaurant().id,
        sessionId,
        tableId: input.tableId,
        source: 'waiter',
        guestId: null,
        staffUid: staff.uid,
        status,
        items,
        totalMinor,
        version: 0,
        statusHistory: [{status, at: new Date(), actorType: 'staff', actorId: staff.uid}],
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      applySessionTotals(tx, sessionId, {
        chargeTotalMinor: session.chargeTotalMinor + totalMinor,
        paidMinor: session.paidMinor,
        adjustmentsMinor: session.adjustmentsMinor,
      });

      const result: SubmitOrderResult = {orderId: orderRef.id, status, totalMinor};
      writeIdempotentResult(tx, scopedKey, 'submitWaiterOrder', result);
      audit(tx, {
        action: 'staff.order.submitted',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: orderRef.path,
        detail: {totalMinor},
      });
      return txOk(result);
    }),
  );
});

/**
 * Advances an order along the permitted state graph. `expectedVersion` makes
 * concurrent taps from two devices safe: the second one fails loudly instead of
 * silently overwriting the first.
 */
export const updateOrderStatus = onCall(callableOptions, async (request): Promise<UpdateOrderStatusResult> => {
  const input = parseInput(updateOrderStatusInput, request.data);
  const staff = await requireStaff(request);

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<UpdateOrderStatusResult>> => {
      const orderRef = refs.order(input.sessionId, input.orderId);
      const snapshot = await tx.get(orderRef);
      if (!snapshot.exists) return txFail('not-found', 'illegal-transition', 'Order not found');
      const order = snapshot.data() as {status: OrderStatus; version: number; totalMinor: number};

      if (order.version !== input.expectedVersion) {
        return txFail('aborted', 'version-conflict', 'This order changed on another device; reload and try again');
      }
      if (!canRoleTransition(staff.role, order.status, input.nextStatus)) {
        return txFail(
          'failed-precondition',
          'illegal-transition',
          `Cannot move an order from ${order.status} to ${input.nextStatus}`,
        );
      }

      // Cancelling removes the order's charge from what the table owes.
      if (input.nextStatus === 'cancelled' && isChargeable(order.status)) {
        const sessionRead = await readOpenSession(tx, input.sessionId);
        if (!sessionRead.ok) return sessionRead;
        applySessionTotals(tx, input.sessionId, {
          chargeTotalMinor: sessionRead.value.chargeTotalMinor - order.totalMinor,
          paidMinor: sessionRead.value.paidMinor,
          adjustmentsMinor: sessionRead.value.adjustmentsMinor,
        });
      }

      const version = order.version + 1;
      tx.update(orderRef, {
        status: input.nextStatus,
        version,
        updatedAt: FieldValue.serverTimestamp(),
        statusHistory: FieldValue.arrayUnion({
          status: input.nextStatus,
          at: new Date(),
          actorType: 'staff',
          actorId: staff.uid,
        }),
      });

      audit(tx, {
        action: 'staff.order.status',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: orderRef.path,
        detail: {from: order.status, to: input.nextStatus},
      });

      return txOk({status: input.nextStatus, version});
    }),
  );
});

/**
 * Records a cash or card payment taken at the table. Payments are append-only
 * rows, so partial and split payments are just several rows; the balance is
 * recomputed from them. The idempotency key stops a double tap taking the
 * money twice (T10).
 */
export const recordManualPayment = onCall(callableOptions, async (request): Promise<RecordManualPaymentResult> => {
  const input = parseInput(recordManualPaymentInput, request.data);
  const staff = await requireStaff(request);
  const scopedKey = scopeIdempotencyKey('recordManualPayment', input.sessionId, input.idempotencyKey);

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<RecordManualPaymentResult>> => {
      const replayed = await readIdempotentResult<RecordManualPaymentResult>(tx, scopedKey);
      if (replayed) return txOk(replayed);

      const sessionRead = await readOpenSession(tx, input.sessionId);
      if (!sessionRead.ok) return sessionRead;
      const session = sessionRead.value;

      const paymentRef = refs.payments(input.sessionId).doc();
      tx.set(paymentRef, {
        type: 'payment',
        amountMinor: input.amountMinor,
        method: input.method satisfies PaymentMethod,
        reference: input.reference,
        staffUid: staff.uid,
        staffName: staff.name,
        reversesPaymentId: null,
        reversedByReversalId: null,
        createdAt: FieldValue.serverTimestamp(),
      });

      const balanceMinor = applySessionTotals(tx, input.sessionId, {
        chargeTotalMinor: session.chargeTotalMinor,
        paidMinor: session.paidMinor + input.amountMinor,
        adjustmentsMinor: session.adjustmentsMinor,
      });

      const result: RecordManualPaymentResult = {paymentId: paymentRef.id, balanceMinor};
      writeIdempotentResult(tx, scopedKey, 'recordManualPayment', result);
      audit(tx, {
        action: 'staff.payment.recorded',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: paymentRef.path,
        detail: {amountMinor: input.amountMinor, method: input.method, balanceMinor},
      });
      return txOk(result);
    }),
  );
});

/**
 * Reverses a recorded payment. Admin-only and append-only: the original row is
 * never deleted or edited away, it is marked and offset by a reversal row.
 */
export const reverseManualPayment = onCall(callableOptions, async (request): Promise<ReverseManualPaymentResult> => {
  const input = parseInput(reverseManualPaymentInput, request.data);
  const staff = await requireAdmin(request);
  const scopedKey = scopeIdempotencyKey('reverseManualPayment', input.sessionId, input.idempotencyKey);

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<ReverseManualPaymentResult>> => {
      const replayed = await readIdempotentResult<ReverseManualPaymentResult>(tx, scopedKey);
      if (replayed) return txOk(replayed);

      const paymentRef = refs.payment(input.sessionId, input.paymentId);
      const snapshot = await tx.get(paymentRef);
      if (!snapshot.exists) return txFail('not-found', 'already-reversed', 'Payment not found');
      const payment = snapshot.data() as {type: string; amountMinor: number; reversedByReversalId: string | null};
      if (payment.type !== 'payment') {
        return txFail('failed-precondition', 'already-reversed', 'Only a payment can be reversed');
      }
      if (payment.reversedByReversalId) {
        return txFail('failed-precondition', 'already-reversed', 'This payment was already reversed');
      }

      const sessionRead = await readOpenSession(tx, input.sessionId);
      if (!sessionRead.ok) return sessionRead;
      const session = sessionRead.value;

      const reversalRef = refs.payments(input.sessionId).doc();
      tx.set(reversalRef, {
        type: 'reversal',
        amountMinor: payment.amountMinor,
        method: null,
        reference: input.reason,
        staffUid: staff.uid,
        staffName: staff.name,
        reversesPaymentId: input.paymentId,
        reversedByReversalId: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(paymentRef, {reversedByReversalId: reversalRef.id, reversedAt: FieldValue.serverTimestamp()});

      const balanceMinor = applySessionTotals(tx, input.sessionId, {
        chargeTotalMinor: session.chargeTotalMinor,
        paidMinor: session.paidMinor - payment.amountMinor,
        adjustmentsMinor: session.adjustmentsMinor,
      });

      const result: ReverseManualPaymentResult = {reversalId: reversalRef.id, balanceMinor};
      writeIdempotentResult(tx, scopedKey, 'reverseManualPayment', result);
      audit(tx, {
        action: 'staff.payment.reversed',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: reversalRef.path,
        detail: {paymentId: input.paymentId, amountMinor: payment.amountMinor, reason: input.reason},
      });
      return txOk(result);
    }),
  );
});

/**
 * Closes a settled table. Requires a zero (or credit) balance, unless an
 * administrator records a written manager exception. Closing revokes the
 * party's capabilities so the next party cannot read their orders (T12).
 */
export const closeDiningSession = onCall(callableOptions, async (request): Promise<CloseDiningSessionResult> => {
  const input = parseInput(closeDiningSessionInput, request.data);
  const staff = await requireStaff(request);

  return unwrap(
    await db.runTransaction(async (tx): Promise<TxResult<CloseDiningSessionResult>> => {
      const sessionRead = await readOpenSession(tx, input.sessionId);
      if (!sessionRead.ok) return sessionRead;
      const session = sessionRead.value;

      if (session.version !== input.expectedVersion) {
        return txFail('aborted', 'version-conflict', 'This table changed on another device; reload and try again');
      }

      const exception = input.managerExceptionReason?.trim();
      if (!isSettled(session.balanceMinor)) {
        if (!exception) {
          return txFail('failed-precondition', 'balance-outstanding', 'This table still has an outstanding balance');
        }
        if (staff.role !== 'admin') {
          return txFail('permission-denied', 'not-admin', 'A manager must authorise closing an unsettled table');
        }
      }

      await revokeSessionCapabilities(tx, input.sessionId);

      const closedAt = Timestamp.now();
      tx.update(refs.session(input.sessionId), {
        status: 'closed',
        closedAt,
        closedBy: staff.uid,
        closedWithExceptionReason: exception ?? null,
        version: session.version + 1,
      });
      tx.update(refs.table(session.tableId), {activeSessionId: null, lastSessionClosedAt: closedAt});

      audit(tx, {
        action: 'staff.session.closed',
        actorType: 'staff',
        actorId: staff.uid,
        targetPath: refs.session(input.sessionId).path,
        detail: {balanceMinor: session.balanceMinor, exceptionReason: exception ?? null},
      });

      return txOk({closedAt: closedAt.toMillis()});
    }),
  );
});
