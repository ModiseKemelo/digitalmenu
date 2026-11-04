/**
 * T06, T07, T09, T10, T11, T15: staff authorization, status transitions,
 * payments, reconciliation and closing.
 */
import {describe, it, expect, beforeAll, beforeEach, afterAll} from 'vitest';
import {
  callFn,
  expectFailure,
  seedTable,
  seedMenuItem,
  restaurant,
  teardown,
  key,
  signInAs,
  signOutStaff,
  makeStaff,
} from './harness';
import type {ResolveTableQrResult, SubmitOrderResult, RecordManualPaymentResult, UpdateOrderStatusResult} from '../../src/lib/contracts';

const resolve = (token: string) => callFn<{token: string}, ResolveTableQrResult>('resolveTableQr', {token});

async function guestOrder(token: string, itemId = 'curry', quantity = 1) {
  const guest = await resolve(token);
  const order = await callFn<unknown, SubmitOrderResult>('submitGuestOrder', {
    capability: guest.capability,
    items: [{itemId, quantity}],
    idempotencyKey: key(),
  });
  return {...guest, order};
}

const sessionDoc = (sessionId: string) => restaurant().collection('sessions').doc(sessionId);

// The database is cleared once by the suite's global setup; each test owns a
// distinct table id and staff account.
beforeAll(async () => {
  await seedMenuItem('curry', {priceMinor: 12500, name: 'Curry'});
});
beforeEach(signOutStaff);
afterAll(teardown);

describe('staff authorization', () => {
  it('rejects an unauthenticated caller', async () => {
    const failure = await expectFailure('updateOrderStatus', {sessionId: 's', orderId: 'o', nextStatus: 'accepted', expectedVersion: 0});
    expect(failure.details?.code).toBe('not-staff');
  });

  it('rejects a signed-in user with no staff record', async () => {
    await signInAs('random@example.com');
    const failure = await expectFailure('updateOrderStatus', {sessionId: 's', orderId: 'o', nextStatus: 'accepted', expectedVersion: 0});
    expect(failure.details?.code).toBe('not-staff');
  });

  // T15: deactivation takes effect immediately, with no token to wait out.
  it('rejects a deactivated staff member', async () => {
    const uid = await signInAs('exwaiter@example.com');
    await makeStaff(uid, 'waiter', false);
    const failure = await expectFailure('updateOrderStatus', {sessionId: 's', orderId: 'o', nextStatus: 'accepted', expectedVersion: 0});
    expect(failure.details?.code).toBe('not-staff');
  });

  it('rejects a waiter from an admin-only action', async () => {
    const uid = await signInAs('waiter-only@example.com');
    await makeStaff(uid, 'waiter');
    const failure = await expectFailure('reverseManualPayment', {
      sessionId: 's',
      paymentId: 'p',
      reason: 'mistake',
      idempotencyKey: key(),
    });
    expect(failure.details?.code).toBe('not-admin');
  });
});

describe('order status transitions', () => {
  // T06/T07: staff advance orders, and only along the permitted graph.
  it('walks an order through the service flow', async () => {
    const token = await seedTable('TBL-100');
    const {sessionId, order} = await guestOrder(token);
    const uid = await signInAs('flow@example.com');
    await makeStaff(uid, 'waiter');

    let version = 0;
    for (const nextStatus of ['accepted', 'preparing', 'ready', 'served'] as const) {
      const result = await callFn<unknown, UpdateOrderStatusResult>('updateOrderStatus', {
        sessionId,
        orderId: order.orderId,
        nextStatus,
        expectedVersion: version,
      });
      expect(result.status).toBe(nextStatus);
      version = result.version;
    }
    expect(version).toBe(4);

    const stored = await sessionDoc(sessionId).collection('orders').doc(order.orderId).get();
    expect(stored.data()?.statusHistory).toHaveLength(5);
  });

  it('refuses a transition outside the graph', async () => {
    const token = await seedTable('TBL-101');
    const {sessionId, order} = await guestOrder(token);
    const uid = await signInAs('graph@example.com');
    await makeStaff(uid, 'waiter');

    const failure = await expectFailure('updateOrderStatus', {
      sessionId,
      orderId: order.orderId,
      nextStatus: 'served',
      expectedVersion: 0,
    });
    expect(failure.details?.code).toBe('illegal-transition');
  });

  // Concurrent taps from two devices must not silently overwrite each other.
  it('rejects a stale expectedVersion', async () => {
    const token = await seedTable('TBL-102');
    const {sessionId, order} = await guestOrder(token);
    const uid = await signInAs('version@example.com');
    await makeStaff(uid, 'waiter');

    await callFn('updateOrderStatus', {sessionId, orderId: order.orderId, nextStatus: 'accepted', expectedVersion: 0});
    const failure = await expectFailure('updateOrderStatus', {
      sessionId,
      orderId: order.orderId,
      nextStatus: 'preparing',
      expectedVersion: 0,
    });
    expect(failure.details?.code).toBe('version-conflict');
  });

  it('limits late cancellation to an administrator', async () => {
    const token = await seedTable('TBL-103');
    const {sessionId, order} = await guestOrder(token);
    const waiterUid = await signInAs('latecancel@example.com');
    await makeStaff(waiterUid, 'waiter');
    await callFn('updateOrderStatus', {sessionId, orderId: order.orderId, nextStatus: 'accepted', expectedVersion: 0});

    const failure = await expectFailure('updateOrderStatus', {
      sessionId,
      orderId: order.orderId,
      nextStatus: 'cancelled',
      expectedVersion: 1,
    });
    expect(failure.details?.code).toBe('illegal-transition');

    await makeStaff(waiterUid, 'admin');
    const result = await callFn<unknown, UpdateOrderStatusResult>('updateOrderStatus', {
      sessionId,
      orderId: order.orderId,
      nextStatus: 'cancelled',
      expectedVersion: 1,
    });
    expect(result.status).toBe('cancelled');
  });

  it('removes a cancelled order from what the table owes', async () => {
    const token = await seedTable('TBL-104');
    const {sessionId, order} = await guestOrder(token);
    const uid = await signInAs('cancelcharge@example.com');
    await makeStaff(uid, 'waiter');

    expect((await sessionDoc(sessionId).get()).data()?.chargeTotalMinor).toBe(12500);
    await callFn('updateOrderStatus', {sessionId, orderId: order.orderId, nextStatus: 'cancelled', expectedVersion: 0});

    const session = await sessionDoc(sessionId).get();
    expect(session.data()?.chargeTotalMinor).toBe(0);
    expect(session.data()?.balanceMinor).toBe(0);
  });
});

describe('waiter assisted orders', () => {
  it('records an assisted order as accepted and attributed', async () => {
    const token = await seedTable('TBL-110');
    await resolve(token);
    const uid = await signInAs('assist@example.com');
    await makeStaff(uid, 'waiter');

    const result = await callFn<unknown, SubmitOrderResult>('submitWaiterOrder', {
      tableId: 'TBL-110',
      items: [{itemId: 'curry', quantity: 2}],
      idempotencyKey: key(),
    });
    expect(result.status).toBe('accepted');
    expect(result.totalMinor).toBe(25000);

    const sessions = await restaurant().collection('sessions').where('tableId', '==', 'TBL-110').get();
    expect(sessions.size).toBe(1);
    const orders = await sessions.docs[0].ref.collection('orders').get();
    expect(orders.docs[0].data().staffUid).toBe(uid);
    expect(orders.docs[0].data().source).toBe('waiter');
  });

  it('opens a session for an idle table', async () => {
    await seedTable('TBL-111');
    const uid = await signInAs('assist2@example.com');
    await makeStaff(uid, 'waiter');

    await callFn('submitWaiterOrder', {tableId: 'TBL-111', items: [{itemId: 'curry', quantity: 1}], idempotencyKey: key()});
    const table = await restaurant().collection('tables').doc('TBL-111').get();
    expect(table.data()?.activeSessionId).toBeTruthy();
  });
});

describe('manual payments', () => {
  // T09: a partial payment updates the balance.
  it('applies partial and split payments', async () => {
    const token = await seedTable('TBL-120');
    const {sessionId} = await guestOrder(token, 'curry', 2); // 25000
    const uid = await signInAs('cashier@example.com');
    await makeStaff(uid, 'waiter');

    const first = await callFn<unknown, RecordManualPaymentResult>('recordManualPayment', {
      sessionId,
      amountMinor: 10000,
      method: 'cash',
      reference: 'till-1',
      idempotencyKey: key(),
    });
    expect(first.balanceMinor).toBe(15000);

    const second = await callFn<unknown, RecordManualPaymentResult>('recordManualPayment', {
      sessionId,
      amountMinor: 15000,
      method: 'card',
      reference: 'auth-9001',
      idempotencyKey: key(),
    });
    expect(second.balanceMinor).toBe(0);

    const payments = await sessionDoc(sessionId).collection('payments').get();
    expect(payments.size).toBe(2);
    expect(payments.docs.every((doc) => doc.data().staffUid === uid)).toBe(true);
  });

  // T10: a duplicate payment request is not applied twice.
  it('does not take the money twice for one key', async () => {
    const token = await seedTable('TBL-121');
    const {sessionId} = await guestOrder(token);
    const uid = await signInAs('double@example.com');
    await makeStaff(uid, 'waiter');
    const payload = {sessionId, amountMinor: 5000, method: 'cash' as const, reference: 'till', idempotencyKey: key()};

    const first = await callFn<unknown, RecordManualPaymentResult>('recordManualPayment', payload);
    const second = await callFn<unknown, RecordManualPaymentResult>('recordManualPayment', payload);

    expect(second.paymentId).toBe(first.paymentId);
    expect(second.balanceMinor).toBe(first.balanceMinor);
    const payments = await sessionDoc(sessionId).collection('payments').get();
    expect(payments.size).toBe(1);
    expect((await sessionDoc(sessionId).get()).data()?.paidMinor).toBe(5000);
  });

  it('reverses a payment append-only and restores the balance', async () => {
    const token = await seedTable('TBL-122');
    const {sessionId} = await guestOrder(token);
    const uid = await signInAs('reverser@example.com');
    await makeStaff(uid, 'admin');

    const payment = await callFn<unknown, RecordManualPaymentResult>('recordManualPayment', {
      sessionId,
      amountMinor: 12500,
      method: 'cash',
      reference: 'till',
      idempotencyKey: key(),
    });
    expect(payment.balanceMinor).toBe(0);

    await callFn('reverseManualPayment', {sessionId, paymentId: payment.paymentId, reason: 'rang up twice', idempotencyKey: key()});

    const session = await sessionDoc(sessionId).get();
    expect(session.data()?.paidMinor).toBe(0);
    expect(session.data()?.balanceMinor).toBe(12500);

    // The original row survives, marked, alongside the reversal row.
    const payments = await sessionDoc(sessionId).collection('payments').get();
    expect(payments.size).toBe(2);
    const original = await sessionDoc(sessionId).collection('payments').doc(payment.paymentId).get();
    expect(original.data()?.reversedByReversalId).toBeTruthy();
    expect(original.data()?.amountMinor).toBe(12500);
  });

  it('refuses to reverse the same payment twice', async () => {
    const token = await seedTable('TBL-123');
    const {sessionId} = await guestOrder(token);
    const uid = await signInAs('reverser2@example.com');
    await makeStaff(uid, 'admin');
    const payment = await callFn<unknown, RecordManualPaymentResult>('recordManualPayment', {
      sessionId,
      amountMinor: 12500,
      method: 'cash',
      reference: 'till',
      idempotencyKey: key(),
    });
    await callFn('reverseManualPayment', {sessionId, paymentId: payment.paymentId, reason: 'first', idempotencyKey: key()});

    const failure = await expectFailure('reverseManualPayment', {
      sessionId,
      paymentId: payment.paymentId,
      reason: 'second',
      idempotencyKey: key(),
    });
    expect(failure.details?.code).toBe('already-reversed');
  });
});

describe('closing a table', () => {
  // T11: a settled table closes; an unsettled one does not.
  it('refuses to close with an outstanding balance', async () => {
    const token = await seedTable('TBL-130');
    const {sessionId} = await guestOrder(token);
    const uid = await signInAs('closer3@example.com');
    await makeStaff(uid, 'waiter');

    const session = await sessionDoc(sessionId).get();
    const failure = await expectFailure('closeDiningSession', {sessionId, expectedVersion: session.data()?.version});
    expect(failure.details?.code).toBe('balance-outstanding');
    expect((await sessionDoc(sessionId).get()).data()?.status).toBe('open');
  });

  it('closes a settled table and frees it for the next party', async () => {
    const token = await seedTable('TBL-131');
    const {sessionId} = await guestOrder(token);
    const uid = await signInAs('closer4@example.com');
    await makeStaff(uid, 'waiter');
    await callFn('recordManualPayment', {sessionId, amountMinor: 12500, method: 'cash', reference: 'till', idempotencyKey: key()});

    const session = await sessionDoc(sessionId).get();
    const result = await callFn<unknown, {closedAt: number}>('closeDiningSession', {
      sessionId,
      expectedVersion: session.data()?.version,
    });
    expect(result.closedAt).toBeGreaterThan(0);

    const closed = await sessionDoc(sessionId).get();
    expect(closed.data()?.status).toBe('closed');
    expect(closed.data()?.closedBy).toBe(uid);
    const table = await restaurant().collection('tables').doc('TBL-131').get();
    expect(table.data()?.activeSessionId).toBeNull();
  });

  it('lets an administrator close an unsettled table with a written reason', async () => {
    const token = await seedTable('TBL-132');
    const {sessionId} = await guestOrder(token);
    const waiterUid = await signInAs('exception@example.com');
    await makeStaff(waiterUid, 'waiter');

    // A waiter may not grant the exception, even with a reason.
    let session = await sessionDoc(sessionId).get();
    const refused = await expectFailure('closeDiningSession', {
      sessionId,
      expectedVersion: session.data()?.version,
      managerExceptionReason: 'guest walked out',
    });
    expect(refused.details?.code).toBe('not-admin');

    await makeStaff(waiterUid, 'admin');
    session = await sessionDoc(sessionId).get();
    await callFn('closeDiningSession', {
      sessionId,
      expectedVersion: session.data()?.version,
      managerExceptionReason: 'guest walked out',
    });

    const closed = await sessionDoc(sessionId).get();
    expect(closed.data()?.status).toBe('closed');
    expect(closed.data()?.closedWithExceptionReason).toBe('guest walked out');
  });

  it('rejects a stale version when closing', async () => {
    const token = await seedTable('TBL-133');
    const {sessionId} = await guestOrder(token);
    const uid = await signInAs('closer5@example.com');
    await makeStaff(uid, 'waiter');
    await callFn('recordManualPayment', {sessionId, amountMinor: 12500, method: 'cash', reference: 'till', idempotencyKey: key()});

    const failure = await expectFailure('closeDiningSession', {sessionId, expectedVersion: 0});
    expect(failure.details?.code).toBe('version-conflict');
  });
});

describe('service request resolution', () => {
  // Without this callable the queue screen can display a guest's call but
  // never clear it, because Firestore denies all client writes.
  it('marks an open request resolved and attributes it', async () => {
    const token = await seedTable('TBL-150');
    const guest = await resolve(token);
    await callFn('submitGuestOrder', {
      capability: guest.capability,
      items: [{itemId: 'curry', quantity: 1}],
      idempotencyKey: key(),
    });
    const created = await callFn<unknown, {requestId: string}>('createServiceRequest', {
      capability: guest.capability,
      type: 'bill',
    });

    const uid = await signInAs('resolver@example.com');
    await makeStaff(uid, 'waiter');
    await callFn('resolveServiceRequest', {requestId: created.requestId});

    const document = await restaurant().collection('serviceRequests').doc(created.requestId).get();
    expect(document.data()?.status).toBe('resolved');
    expect(document.data()?.resolvedBy).toBe(uid);
    expect(document.data()?.resolvedAt).toBeTruthy();

    const logs = await restaurant().collection('auditLogs').get();
    const resolved = logs.docs.filter((doc) => doc.data().action === 'staff.serviceRequest.resolved');
    expect(resolved.some((doc) => (doc.data().targetPath ?? '').includes(created.requestId))).toBe(true);
  });

  // Two waiters tapping "mark done" at once must not both claim the request.
  it('refuses to resolve the same request twice', async () => {
    const token = await seedTable('TBL-151');
    const guest = await resolve(token);
    await callFn('submitGuestOrder', {
      capability: guest.capability,
      items: [{itemId: 'curry', quantity: 1}],
      idempotencyKey: key(),
    });
    const created = await callFn<unknown, {requestId: string}>('createServiceRequest', {
      capability: guest.capability,
      type: 'bill',
    });

    const uid = await signInAs('resolver2@example.com');
    await makeStaff(uid, 'waiter');
    await callFn('resolveServiceRequest', {requestId: created.requestId});

    const failure = await expectFailure('resolveServiceRequest', {requestId: created.requestId});
    expect(failure.details?.code).toBe('already-resolved');
  });

  it('rejects a caller who is not staff', async () => {
    const token = await seedTable('TBL-152');
    const guest = await resolve(token);
    await callFn('submitGuestOrder', {
      capability: guest.capability,
      items: [{itemId: 'curry', quantity: 1}],
      idempotencyKey: key(),
    });
    const created = await callFn<unknown, {requestId: string}>('createServiceRequest', {
      capability: guest.capability,
      type: 'bill',
    });

    await signOutStaff();
    const failure = await expectFailure('resolveServiceRequest', {requestId: created.requestId});
    expect(failure.details?.code).toBe('not-staff');
  });

  it('reports a request that no longer exists', async () => {
    const uid = await signInAs('resolver3@example.com');
    await makeStaff(uid, 'waiter');
    const failure = await expectFailure('resolveServiceRequest', {requestId: 'no-such-request'});
    expect(failure.details?.code).toBe('invalid-request');
  });
});

describe('audit trail', () => {
  // Acceptance criterion 9: staff actions are attributed and auditable.
  it('attributes every privileged action', async () => {
    const token = await seedTable('TBL-140');
    const {sessionId} = await guestOrder(token);
    const uid = await signInAs('audited@example.com');
    await makeStaff(uid, 'waiter');
    await callFn('recordManualPayment', {sessionId, amountMinor: 12500, method: 'cash', reference: 'till', idempotencyKey: key()});

    const logs = await restaurant().collection('auditLogs').get();
    const forThisSession = logs.docs.filter((doc) => (doc.data().targetPath ?? '').includes(sessionId));
    const actions = forThisSession.map((doc) => doc.data().action);
    expect(actions).toContain('guest.capability.issued');
    expect(actions).toContain('guest.order.submitted');
    expect(actions).toContain('staff.payment.recorded');

    const payment = forThisSession.find((doc) => doc.data().action === 'staff.payment.recorded');
    expect(payment?.data().actorId).toBe(uid);
    expect(payment?.data().actorType).toBe('staff');
  });
});

describe('QR rotation', () => {
  it('rotates a token, revoking the old one', async () => {
    const token = await seedTable('TBL-150');
    const uid = await signInAs('rotator@example.com');
    await makeStaff(uid, 'admin');

    const result = await callFn<unknown, {printableQrPayload: string; tokenVersion: number}>('rotateTableQrToken', {
      tableId: 'TBL-150',
    });
    expect(result.tokenVersion).toBe(2);
    expect(result.printableQrPayload).toContain('/t/');
    await signOutStaff();

    // The old printed label stops working; the new one resolves.
    const failure = await expectFailure('resolveTableQr', {token});
    expect(failure.details?.code).toBe('invalid-qr');

    const newToken = result.printableQrPayload.split('/t/')[1];
    const resolved = await resolve(newToken);
    expect(resolved.tableLabel).toBe('TBL-150');
  });

  it('refuses rotation for a waiter', async () => {
    await seedTable('TBL-151');
    const uid = await signInAs('norotate@example.com');
    await makeStaff(uid, 'waiter');
    const failure = await expectFailure('rotateTableQrToken', {tableId: 'TBL-151'});
    expect(failure.details?.code).toBe('not-admin');
  });
});
