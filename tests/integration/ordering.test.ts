/**
 * T01-T13: QR resolution, guest ordering, concurrency, idempotency and privacy.
 */
import {describe, it, expect, beforeAll, beforeEach, afterAll} from 'vitest';
import {
  callFn,
  expectFailure,
  seedTable,
  seedMenuItem,
  restaurant,
  admin,
  teardown,
  key,
  signInAs,
  makeStaff,
  signOutStaff,
  hashToken,
} from './harness';
import type {ResolveTableQrResult, SubmitOrderResult, GuestSessionView} from '../../src/lib/contracts';

const resolve = (token: string) => callFn<{token: string}, ResolveTableQrResult>('resolveTableQr', {token});

// The database is cleared once by the suite's global setup; every test here
// owns a distinct table id and its own guest capabilities, so seeding the shared
// menu items is all this file needs.
beforeAll(async () => {
  await seedMenuItem('curry', {priceMinor: 12500, name: 'Curry'});
  await seedMenuItem('naan', {priceMinor: 2500, name: 'Naan'});
});
beforeEach(signOutStaff);
afterAll(teardown);

describe('QR resolution', () => {
  // T01: a valid QR opens only its own table.
  it('resolves a token to its own table and opens a session', async () => {
    const tokenOne = await seedTable('TBL-001', 'Table 01');
    const tokenTwo = await seedTable('TBL-002', 'Table 02');

    const one = await resolve(tokenOne);
    const two = await resolve(tokenTwo);

    expect(one.tableLabel).toBe('Table 01');
    expect(two.tableLabel).toBe('Table 02');
    expect(one.sessionId).not.toBe(two.sessionId);
    expect(one.capability).not.toBe(two.capability);
    expect(one.capabilityExpiresAt).toBeGreaterThan(Date.now());
  });

  // T02: an unknown or disabled QR fails safely.
  it('rejects an unknown token', async () => {
    const failure = await expectFailure('resolveTableQr', {token: 'a'.repeat(43)});
    expect(failure.details?.code).toBe('invalid-qr');
  });

  it('rejects a disabled table', async () => {
    const token = await seedTable('TBL-003', 'Table 03', false);
    const failure = await expectFailure('resolveTableQr', {token});
    expect(failure.details?.code).toBe('table-disabled');
  });

  it('rejects a rotated-out token', async () => {
    const token = await seedTable('TBL-004', 'Table 04');
    await admin().collection('qrTokens').doc(hashToken(token)).update({revoked: true});
    const failure = await expectFailure('resolveTableQr', {token});
    expect(failure.details?.code).toBe('invalid-qr');
  });

  it('never stores the raw token', async () => {
    const token = await seedTable('TBL-005', 'Table 05');
    const tokens = await admin().collection('qrTokens').get();
    const serialised = JSON.stringify(tokens.docs.map((doc) => ({id: doc.id, ...doc.data()})));
    expect(serialised).not.toContain(token);
  });

  // One open session per table, however many guests scan.
  it('joins both guests at a table to one session', async () => {
    const token = await seedTable('TBL-006');
    const [first, second] = await Promise.all([resolve(token), resolve(token)]);
    expect(first.sessionId).toBe(second.sessionId);
    expect(first.capability).not.toBe(second.capability);
  });
});

describe('guest ordering', () => {
  it('prices the order from Firestore, not the request', async () => {
    const token = await seedTable('TBL-010');
    const {capability} = await resolve(token);

    const result = await callFn<Record<string, unknown>, SubmitOrderResult>('submitGuestOrder', {
      capability,
      // A forged price must be ignored entirely.
      items: [{itemId: 'curry', quantity: 2, unitPriceMinor: 1, lineTotalMinor: 1}],
      idempotencyKey: key(),
      totalMinor: 1,
    });

    expect(result.totalMinor).toBe(25000);
    expect(result.status).toBe('received');
  });

  it('adds option deltas server-side', async () => {
    await seedMenuItem('biryani', {
      priceMinor: 15000,
      options: [
        {id: 'extra-raita', name: 'Extra raita', priceDeltaMinor: 1500},
        {id: 'mild', name: 'Mild', priceDeltaMinor: 0},
      ],
    });
    const token = await seedTable('TBL-011');
    const {capability} = await resolve(token);

    const result = await callFn<unknown, SubmitOrderResult>('submitGuestOrder', {
      capability,
      items: [{itemId: 'biryani', quantity: 1, optionIds: ['extra-raita', 'mild']}],
      idempotencyKey: key(),
    });
    expect(result.totalMinor).toBe(16500);
  });

  it('rejects an option that does not belong to the item', async () => {
    const token = await seedTable('TBL-012');
    const {capability} = await resolve(token);
    const failure = await expectFailure('submitGuestOrder', {
      capability,
      items: [{itemId: 'curry', quantity: 1, optionIds: ['not-a-real-option']}],
      idempotencyKey: key(),
    });
    expect(failure.details?.code).toBe('option-invalid');
  });

  // T03: an unpublished or unavailable item is not orderable.
  it('refuses unpublished and unavailable items', async () => {
    await seedMenuItem('draft-item', {published: false});
    await seedMenuItem('soldout-item', {available: false});
    const token = await seedTable('TBL-013');
    const {capability} = await resolve(token);

    for (const itemId of ['draft-item', 'soldout-item']) {
      const failure = await expectFailure('submitGuestOrder', {capability, items: [{itemId, quantity: 1}], idempotencyKey: key()});
      expect(failure.details?.code).toBe('item-unavailable');
    }
  });

  // T05: a retry preserves exactly one order.
  it('returns the original order when a request is retried', async () => {
    const token = await seedTable('TBL-014');
    const {capability, sessionId} = await resolve(token);
    const idempotencyKey = key();
    const payload = {capability, items: [{itemId: 'curry', quantity: 1}], idempotencyKey};

    const first = await callFn<unknown, SubmitOrderResult>('submitGuestOrder', payload);
    const second = await callFn<unknown, SubmitOrderResult>('submitGuestOrder', payload);

    expect(second.orderId).toBe(first.orderId);
    const orders = await restaurant().collection('sessions').doc(sessionId).collection('orders').get();
    expect(orders.size).toBe(1);
    const session = await restaurant().collection('sessions').doc(sessionId).get();
    expect(session.data()?.chargeTotalMinor).toBe(12500);
  });

  it('deduplicates concurrent retries of the same key', async () => {
    const token = await seedTable('TBL-015');
    const {capability, sessionId} = await resolve(token);
    const payload = {capability, items: [{itemId: 'curry', quantity: 1}], idempotencyKey: key()};

    const results = await Promise.allSettled([
      callFn<unknown, SubmitOrderResult>('submitGuestOrder', payload),
      callFn<unknown, SubmitOrderResult>('submitGuestOrder', payload),
    ]);
    const succeeded = results.filter((r) => r.status === 'fulfilled');
    expect(succeeded.length).toBeGreaterThanOrEqual(1);

    const orders = await restaurant().collection('sessions').doc(sessionId).collection('orders').get();
    expect(orders.size).toBe(1);
  });

  // T04: two guests at one table create two distinct orders, no overwrite.
  it('keeps distinct orders from two guests at one table', async () => {
    const token = await seedTable('TBL-016');
    const [guestOne, guestTwo] = await Promise.all([resolve(token), resolve(token)]);

    const [orderOne, orderTwo] = await Promise.all([
      callFn<unknown, SubmitOrderResult>('submitGuestOrder', {
        capability: guestOne.capability,
        items: [{itemId: 'curry', quantity: 1}],
        idempotencyKey: key(),
      }),
      callFn<unknown, SubmitOrderResult>('submitGuestOrder', {
        capability: guestTwo.capability,
        items: [{itemId: 'naan', quantity: 2}],
        idempotencyKey: key(),
      }),
    ]);

    expect(orderOne.orderId).not.toBe(orderTwo.orderId);
    const session = await restaurant().collection('sessions').doc(guestOne.sessionId).get();
    // Both orders must be counted; neither may overwrite the other's charge.
    expect(session.data()?.chargeTotalMinor).toBe(12500 + 5000);
  });

  it('merges a duplicated line into one quantity', async () => {
    const token = await seedTable('TBL-017');
    const {capability} = await resolve(token);
    const result = await callFn<unknown, SubmitOrderResult>('submitGuestOrder', {
      capability,
      items: [
        {itemId: 'curry', quantity: 1},
        {itemId: 'curry', quantity: 2},
      ],
      idempotencyKey: key(),
    });
    expect(result.totalMinor).toBe(37500);
  });

  it('requires a capability', async () => {
    const failure = await expectFailure('submitGuestOrder', {
      capability: 'z'.repeat(43),
      items: [{itemId: 'curry', quantity: 1}],
      idempotencyKey: key(),
    });
    expect(failure.details?.code).toBe('capability-revoked');
  });

  it('rejects a malformed request before touching data', async () => {
    const token = await seedTable('TBL-018');
    const {capability} = await resolve(token);
    const failure = await expectFailure('submitGuestOrder', {capability, items: [], idempotencyKey: key()});
    expect(failure.code).toBe('functions/invalid-argument');
  });
});

describe('guest privacy', () => {
  // T08/T12: a guest sees only their own orders, never another guest's or table's.
  it('scopes the session view to the guest\'s own orders', async () => {
    const token = await seedTable('TBL-020');
    const [guestOne, guestTwo] = await Promise.all([resolve(token), resolve(token)]);

    await callFn('submitGuestOrder', {capability: guestOne.capability, items: [{itemId: 'curry', quantity: 1}], idempotencyKey: key()});
    await callFn('submitGuestOrder', {capability: guestTwo.capability, items: [{itemId: 'naan', quantity: 1}], idempotencyKey: key()});

    const viewOne = await callFn<unknown, GuestSessionView>('getGuestSessionView', {capability: guestOne.capability});
    expect(viewOne.orders).toHaveLength(1);
    expect(viewOne.orders[0].items[0].name).toBe('Curry');
    expect(viewOne.ownTotalMinor).toBe(12500);
  });

  // T12: a new party cannot read the previous party's orders.
  it('revokes capabilities when the table is closed', async () => {
    const token = await seedTable('TBL-021');
    const guest = await resolve(token);
    await callFn('submitGuestOrder', {capability: guest.capability, items: [{itemId: 'curry', quantity: 1}], idempotencyKey: key()});

    const uid = await signInAs('closer@example.com');
    await makeStaff(uid, 'waiter');
    await callFn('recordManualPayment', {
      sessionId: guest.sessionId,
      amountMinor: 12500,
      method: 'cash',
      reference: 'cash',
      idempotencyKey: key(),
    });
    const session = await restaurant().collection('sessions').doc(guest.sessionId).get();
    await callFn('closeDiningSession', {sessionId: guest.sessionId, expectedVersion: session.data()?.version});
    await signOutStaff();

    const failure = await expectFailure('getGuestSessionView', {capability: guest.capability});
    expect(failure.details?.code).toBe('capability-revoked');

    // The next party gets a brand new session at the same table.
    const nextParty = await resolve(token);
    expect(nextParty.sessionId).not.toBe(guest.sessionId);
    const nextView = await callFn<unknown, GuestSessionView>('getGuestSessionView', {capability: nextParty.capability});
    expect(nextView.orders).toHaveLength(0);
  });

  it('refuses to order against a closed session', async () => {
    const token = await seedTable('TBL-022');
    const guest = await resolve(token);
    const uid = await signInAs('closer2@example.com');
    await makeStaff(uid, 'admin');
    const session = await restaurant().collection('sessions').doc(guest.sessionId).get();
    await callFn('closeDiningSession', {sessionId: guest.sessionId, expectedVersion: session.data()?.version});
    await signOutStaff();

    const failure = await expectFailure('submitGuestOrder', {
      capability: guest.capability,
      items: [{itemId: 'curry', quantity: 1}],
      idempotencyKey: key(),
    });
    // The capability is revoked at close, so access is refused before the session check.
    expect(failure.details?.code).toBe('capability-revoked');
  });
});

describe('service requests', () => {
  it('creates a bill request and rate limits repeats', async () => {
    const token = await seedTable('TBL-030');
    const {capability, sessionId} = await resolve(token);
    await callFn('submitGuestOrder', {capability, items: [{itemId: 'curry', quantity: 1}], idempotencyKey: key()});

    for (let i = 0; i < 3; i += 1) {
      await callFn('createServiceRequest', {capability, type: 'bill'});
    }
    const failure = await expectFailure('createServiceRequest', {capability, type: 'bill'});
    expect(failure.details?.code).toBe('rate-limited');

    const requests = await restaurant().collection('serviceRequests').where('sessionId', '==', sessionId).get();
    expect(requests.size).toBe(3);
  });

  // The limit is a sliding window, so the cap holds no matter where the
  // requests fall relative to a clock boundary.
  it('counts the two request types separately', async () => {
    const token = await seedTable('TBL-031');
    const {capability} = await resolve(token);
    await callFn('submitGuestOrder', {capability, items: [{itemId: 'curry', quantity: 1}], idempotencyKey: key()});

    for (let i = 0; i < 3; i += 1) await callFn('createServiceRequest', {capability, type: 'bill'});
    const billBlocked = await expectFailure('createServiceRequest', {capability, type: 'bill'});
    expect(billBlocked.details?.code).toBe('rate-limited');

    // Asking for assistance must still be possible once bill requests are capped.
    await callFn('createServiceRequest', {capability, type: 'assistance'});
  });

  // A P0.00 bill is not a bill: a waiter must not be sent to print one.
  it('refuses a bill request when nothing has been ordered', async () => {
    const token = await seedTable('TBL-032');
    const {capability, sessionId} = await resolve(token);

    const failure = await expectFailure('createServiceRequest', {capability, type: 'bill'});
    expect(failure.details?.code).toBe('nothing-to-bill');

    const requests = await restaurant().collection('serviceRequests').where('sessionId', '==', sessionId).get();
    expect(requests.size).toBe(0);

    // Ordering is what makes the bill real, and the same call then succeeds.
    await callFn('submitGuestOrder', {capability, items: [{itemId: 'curry', quantity: 1}], idempotencyKey: key()});
    await callFn('createServiceRequest', {capability, type: 'bill'});
    const after = await restaurant().collection('serviceRequests').where('sessionId', '==', sessionId).get();
    expect(after.size).toBe(1);
  });

  // The guard must not strand a guest who needs help but has ordered nothing.
  it('still allows assistance when nothing has been ordered', async () => {
    const token = await seedTable('TBL-033');
    const {capability, sessionId} = await resolve(token);

    await callFn('createServiceRequest', {capability, type: 'assistance'});
    const requests = await restaurant().collection('serviceRequests').where('sessionId', '==', sessionId).get();
    expect(requests.size).toBe(1);
    expect(requests.docs[0].data().type).toBe('assistance');
  });

  // Cancelling the only order takes the table's charge total back to zero, so
  // the bill becomes unrequestable again rather than staying stuck as P0.00.
  it('refuses a bill request once the only order is cancelled', async () => {
    const token = await seedTable('TBL-034');
    const {capability, sessionId} = await resolve(token);
    const order = await callFn<unknown, SubmitOrderResult>('submitGuestOrder', {
      capability,
      items: [{itemId: 'curry', quantity: 1}],
      idempotencyKey: key(),
    });

    const uid = await signInAs('canceller@example.com');
    await makeStaff(uid, 'admin');
    await callFn('updateOrderStatus', {sessionId, orderId: order.orderId, nextStatus: 'cancelled', expectedVersion: 0});
    await signOutStaff();

    const failure = await expectFailure('createServiceRequest', {capability, type: 'bill'});
    expect(failure.details?.code).toBe('nothing-to-bill');
  });

  // The flag the bill screen uses to disable its button must agree with the
  // callable, and must be true for a guest who has personally ordered nothing.
  it('reports whether the table owes anything without revealing the amount', async () => {
    const token = await seedTable('TBL-035');
    const [guestOne, guestTwo] = await Promise.all([resolve(token), resolve(token)]);

    const before = await callFn<unknown, GuestSessionView>('getGuestSessionView', {capability: guestOne.capability});
    expect(before.tableHasChargeableOrders).toBe(false);

    await callFn('submitGuestOrder', {
      capability: guestOne.capability,
      items: [{itemId: 'curry', quantity: 1}],
      idempotencyKey: key(),
    });

    // Guest two has ordered nothing, yet may still settle the table's bill.
    const view = await callFn<unknown, GuestSessionView>('getGuestSessionView', {capability: guestTwo.capability});
    expect(view.tableHasChargeableOrders).toBe(true);
    expect(view.ownTotalMinor).toBe(0);
    await callFn('createServiceRequest', {capability: guestTwo.capability, type: 'bill'});
  });
});
