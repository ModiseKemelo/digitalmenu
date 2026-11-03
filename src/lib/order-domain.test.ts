import {describe, it, expect} from 'vitest';
import {
  canTransition,
  canRoleTransition,
  nextStatuses,
  isActiveStatus,
  isChargeable,
  lineTotal,
  unitPriceWithOptions,
  orderTotal,
  outstanding,
  sessionBalance,
  isSettled,
  mergeLines,
  formatBwp,
} from './order-domain';
import {submitGuestOrderInput, recordManualPaymentInput, updateOrderStatusInput, MAX_LINE_QUANTITY} from './contracts';

describe('order status graph', () => {
  it('permits the service flow', () => {
    expect(canTransition('received', 'accepted')).toBe(true);
    expect(canTransition('accepted', 'preparing')).toBe(true);
    expect(canTransition('preparing', 'ready')).toBe(true);
    expect(canTransition('ready', 'served')).toBe(true);
  });

  it('rejects backwards and terminal transitions', () => {
    expect(canTransition('served', 'received')).toBe(false);
    expect(canTransition('preparing', 'accepted')).toBe(false);
    expect(canTransition('cancelled', 'received')).toBe(false);
    expect(canTransition('served', 'cancelled')).toBe(false);
  });

  it('does not allow skipping a step', () => {
    expect(canTransition('received', 'ready')).toBe(false);
    expect(canTransition('accepted', 'served')).toBe(false);
  });

  // T07: waiter changes allowed status only.
  it('limits late cancellation to admins', () => {
    expect(canRoleTransition('waiter', 'received', 'cancelled')).toBe(true);
    expect(canRoleTransition('waiter', 'accepted', 'cancelled')).toBe(false);
    expect(canRoleTransition('admin', 'accepted', 'cancelled')).toBe(true);
  });

  it('never widens the graph for admins', () => {
    expect(canRoleTransition('admin', 'served', 'preparing')).toBe(false);
  });

  it('reports the queue-visible statuses', () => {
    expect(nextStatuses('received')).toEqual(['accepted', 'cancelled']);
    expect(isActiveStatus('ready')).toBe(true);
    expect(isActiveStatus('served')).toBe(false);
    expect(isChargeable('cancelled')).toBe(false);
    expect(isChargeable('served')).toBe(true);
  });
});

describe('integer money', () => {
  it('calculates line and order totals', () => {
    expect(lineTotal(12500, 2)).toBe(25000);
    expect(orderTotal([{lineTotalMinor: 25000}, {lineTotalMinor: 2500}])).toBe(27500);
    expect(orderTotal([])).toBe(0);
  });

  it('adds option deltas to the unit price', () => {
    expect(unitPriceWithOptions(12500, [])).toBe(12500);
    expect(unitPriceWithOptions(12500, [1500, -500])).toBe(13500);
    expect(() => unitPriceWithOptions(1000, [-2000])).toThrow();
    expect(() => unitPriceWithOptions(1000, [1.5])).toThrow();
  });

  it('rejects bad quantities and non-integer money', () => {
    expect(() => lineTotal(100, 0)).toThrow();
    expect(() => lineTotal(100, MAX_LINE_QUANTITY + 1)).toThrow();
    expect(() => lineTotal(100, 1.5)).toThrow();
    expect(() => lineTotal(12.5, 2)).toThrow();
    expect(() => lineTotal(-100, 2)).toThrow();
  });

  // T09: partial payment updates balance.
  it('tracks outstanding and session balance', () => {
    expect(outstanding(25000, 10000)).toBe(15000);
    expect(outstanding(25000, 30000)).toBe(0);
    expect(sessionBalance({chargeTotalMinor: 25000, paidMinor: 10000})).toBe(15000);
    expect(sessionBalance({chargeTotalMinor: 25000, paidMinor: 25000})).toBe(0);
  });

  it('keeps an overpayment visible as a negative balance', () => {
    expect(sessionBalance({chargeTotalMinor: 25000, paidMinor: 30000})).toBe(-5000);
  });

  it('applies approved adjustments', () => {
    expect(sessionBalance({chargeTotalMinor: 25000, paidMinor: 0, adjustmentsMinor: 5000})).toBe(20000);
  });

  // T11: settled table closes.
  it('treats a zero or credit balance as settled', () => {
    expect(isSettled(0)).toBe(true);
    expect(isSettled(-500)).toBe(true);
    expect(isSettled(1)).toBe(false);
  });

  it('formats thebe as BWP', () => {
    expect(formatBwp(12500)).toContain('125');
  });
});

describe('cart line merging', () => {
  const line = (itemId: string, quantity: number, optionIds: string[] = [], notes = '') => ({itemId, quantity, optionIds, notes});

  it('merges identical lines', () => {
    const merged = mergeLines([line('curry', 1), line('curry', 2)]);
    expect(merged).toHaveLength(1);
    expect(merged[0].quantity).toBe(3);
  });

  it('keeps lines with different options or notes apart', () => {
    expect(mergeLines([line('curry', 1, ['mild']), line('curry', 1, ['hot'])])).toHaveLength(2);
    expect(mergeLines([line('curry', 1, [], 'no onion'), line('curry', 1)])).toHaveLength(2);
  });

  it('ignores option ordering when matching', () => {
    expect(mergeLines([line('curry', 1, ['a', 'b']), line('curry', 1, ['b', 'a'])])).toHaveLength(1);
  });

  it('does not let merging exceed the quantity cap', () => {
    expect(() => mergeLines([line('curry', 60), line('curry', 60)])).toThrow();
  });

  it('does not mutate the caller option arrays', () => {
    const original = line('curry', 1, ['a']);
    mergeLines([original, line('curry', 1, ['a'])]);
    expect(original.quantity).toBe(1);
  });
});

describe('request contracts', () => {
  const key = 'a'.repeat(24);

  it('accepts a well formed guest order', () => {
    const parsed = submitGuestOrderInput.parse({
      capability: 'c'.repeat(32),
      items: [{itemId: 'sample-curry', quantity: 2}],
      idempotencyKey: key,
    });
    expect(parsed.items[0].optionIds).toEqual([]);
    expect(parsed.items[0].notes).toBe('');
  });

  it('rejects an empty cart and a short idempotency key', () => {
    expect(() => submitGuestOrderInput.parse({capability: 'c'.repeat(32), items: [], idempotencyKey: key})).toThrow();
    expect(() =>
      submitGuestOrderInput.parse({capability: 'c'.repeat(32), items: [{itemId: 'x', quantity: 1}], idempotencyKey: 'short'}),
    ).toThrow();
  });

  // Client-supplied totals must never reach the server surface at all.
  it('strips any client supplied price', () => {
    const parsed = submitGuestOrderInput.parse({
      capability: 'c'.repeat(32),
      items: [{itemId: 'sample-curry', quantity: 1, unitPriceMinor: 1, lineTotalMinor: 1}],
      idempotencyKey: key,
      totalMinor: 1,
    });
    expect(parsed).not.toHaveProperty('totalMinor');
    expect(parsed.items[0]).not.toHaveProperty('unitPriceMinor');
    expect(parsed.items[0]).not.toHaveProperty('lineTotalMinor');
  });

  it('rejects fractional and non-positive payments', () => {
    expect(() => recordManualPaymentInput.parse({sessionId: 's1', amountMinor: 10.5, method: 'cash', idempotencyKey: key})).toThrow();
    expect(() => recordManualPaymentInput.parse({sessionId: 's1', amountMinor: 0, method: 'cash', idempotencyKey: key})).toThrow();
    expect(() => recordManualPaymentInput.parse({sessionId: 's1', amountMinor: 100, method: 'crypto', idempotencyKey: key})).toThrow();
  });

  it('requires an expected version on status updates', () => {
    expect(() => updateOrderStatusInput.parse({sessionId: 's1', orderId: 'o1', nextStatus: 'accepted'})).toThrow();
    expect(() => updateOrderStatusInput.parse({sessionId: 's1', orderId: 'o1', nextStatus: 'teleported', expectedVersion: 0})).toThrow();
  });
});
