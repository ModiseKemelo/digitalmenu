/**
 * Pure order/money domain logic. Isomorphic: imported by the Next.js client and
 * by the Cloud Functions, so no `node:*` and no Firebase imports belong here.
 *
 * All money is an integer count of thebe (1 BWP = 100 thebe). Floating point is
 * never used for money; see docs/04-SECURITY-AND-DATA.md.
 */
import {
  MAX_LINE_QUANTITY,
  type OrderLineInput,
  type OrderLineSnapshot,
  type OrderStatus,
  type StaffRole,
} from './contracts';

export type {OrderStatus};

/** The only permitted order state transitions. */
const transitions: Record<OrderStatus, OrderStatus[]> = {
  received: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready'],
  ready: ['served'],
  served: [],
  cancelled: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return transitions[from].includes(to);
}

export function nextStatuses(from: OrderStatus): OrderStatus[] {
  return [...transitions[from]];
}

/**
 * Role gate on top of the state graph. A waiter drives the normal service flow;
 * cancelling an order that kitchen work has already started on is an admin call.
 */
export function canRoleTransition(role: StaffRole, from: OrderStatus, to: OrderStatus): boolean {
  if (!canTransition(from, to)) return false;
  if (to === 'cancelled' && from === 'accepted' && role !== 'admin') return false;
  return true;
}

/** Statuses that still owe the guest food, used for dashboard queues. */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['received', 'accepted', 'preparing', 'ready'];

export function isActiveStatus(status: OrderStatus): boolean {
  return ACTIVE_ORDER_STATUSES.includes(status);
}

/** A cancelled order contributes nothing to what the table owes. */
export function isChargeable(status: OrderStatus): boolean {
  return status !== 'cancelled';
}

export function assertMinor(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid ${label}: expected a non-negative integer of thebe`);
  return value;
}

export function lineTotal(unitPriceMinor: number, quantity: number): number {
  assertMinor(unitPriceMinor, 'unit price');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) throw new Error('Invalid line quantity');
  return unitPriceMinor * quantity;
}

/** Unit price of one line including its selected options. */
export function unitPriceWithOptions(basePriceMinor: number, optionDeltasMinor: number[]): number {
  assertMinor(basePriceMinor, 'base price');
  const unit = optionDeltasMinor.reduce((sum, delta) => {
    if (!Number.isSafeInteger(delta)) throw new Error('Invalid option price delta');
    return sum + delta;
  }, basePriceMinor);
  if (unit < 0) throw new Error('Option deltas cannot make a line negative');
  return unit;
}

export function orderTotal(lines: {lineTotalMinor: number}[]): number {
  return lines.reduce((sum, line) => sum + assertMinor(line.lineTotalMinor, 'line total'), 0);
}

export function outstanding(totalMinor: number, paidMinor: number): number {
  return Math.max(0, totalMinor - paidMinor);
}

/**
 * Session balance = chargeable order totals - (payments - reversals) - approved
 * adjustments. May be negative when a table has overpaid, so it is not clamped.
 */
export function sessionBalance(input: {
  chargeTotalMinor: number;
  paidMinor: number;
  adjustmentsMinor?: number;
}): number {
  const {chargeTotalMinor, paidMinor, adjustmentsMinor = 0} = input;
  assertMinor(chargeTotalMinor, 'charge total');
  assertMinor(paidMinor, 'paid total');
  return chargeTotalMinor - paidMinor - adjustmentsMinor;
}

export function isSettled(balanceMinor: number): boolean {
  return balanceMinor <= 0;
}

/** Collapse duplicate lines so two taps of the same item become quantity 2. */
export function mergeLines(lines: OrderLineInput[]): OrderLineInput[] {
  const merged = new Map<string, OrderLineInput>();
  for (const line of lines) {
    const key = `${line.itemId}|${[...line.optionIds].sort().join(',')}|${line.notes}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, {...line, optionIds: [...line.optionIds]});
      continue;
    }
    const quantity = existing.quantity + line.quantity;
    if (quantity > MAX_LINE_QUANTITY) throw new Error('Line quantity exceeds the permitted maximum');
    existing.quantity = quantity;
  }
  return [...merged.values()];
}

export function cartTotal(lines: OrderLineSnapshot[]): number {
  return orderTotal(lines);
}

export const formatBwp = (minor: number): string =>
  new Intl.NumberFormat('en-BW', {style: 'currency', currency: 'BWP'}).format(minor / 100);
