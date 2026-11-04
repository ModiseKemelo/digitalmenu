/**
 * Shared request/response contracts for every privileged action.
 *
 * Source of truth for docs/09-API-CONTRACTS.md. Imported by both the Next.js
 * client and the Cloud Functions, so this file must stay isomorphic: no
 * `node:*` imports and no Firebase SDK imports.
 *
 * Money is always an integer count of thebe (1 BWP = 100 thebe).
 */
import {z} from 'zod';

export const ORDER_STATUSES = ['received', 'accepted', 'preparing', 'ready', 'served', 'cancelled'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'card'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const SERVICE_REQUEST_TYPES = ['bill', 'assistance'] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

export const STAFF_ROLES = ['waiter', 'admin'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Guest capabilities are deliberately short lived; see docs/04. */
export const GUEST_CAPABILITY_TTL_MS = 3 * 60 * 60 * 1000;
export const MAX_LINE_QUANTITY = 99;
export const MAX_ORDER_LINES = 40;
/** Largest amount a single manual payment may record, as a guard against typos. */
export const MAX_PAYMENT_MINOR = 100_000_00;

const idempotencyKey = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/, 'idempotencyKey must be URL-safe');
const opaqueToken = z.string().trim().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/, 'token must be URL-safe');
const docId = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/, 'identifier must be URL-safe');
const freeText = z.string().trim().max(280);

export const orderLineInput = z.object({
  itemId: docId,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
  optionIds: z.array(docId).max(12).default([]),
  notes: freeText.default(''),
});
export type OrderLineInput = z.infer<typeof orderLineInput>;

const orderLines = z.array(orderLineInput).min(1).max(MAX_ORDER_LINES);

export const resolveTableQrInput = z.object({token: opaqueToken});
export const submitGuestOrderInput = z.object({capability: opaqueToken, items: orderLines, idempotencyKey});
export const guestSessionViewInput = z.object({capability: opaqueToken});
export const createServiceRequestInput = z.object({capability: opaqueToken, type: z.enum(SERVICE_REQUEST_TYPES)});
export const resolveServiceRequestInput = z.object({requestId: docId});
export const submitWaiterOrderInput = z.object({tableId: docId, items: orderLines, idempotencyKey});
export const updateOrderStatusInput = z.object({
  sessionId: docId,
  orderId: docId,
  nextStatus: z.enum(ORDER_STATUSES),
  expectedVersion: z.number().int().min(0),
});
export const recordManualPaymentInput = z.object({
  sessionId: docId,
  amountMinor: z.number().int().min(1).max(MAX_PAYMENT_MINOR),
  method: z.enum(PAYMENT_METHODS),
  reference: freeText.default(''),
  idempotencyKey,
});
export const reverseManualPaymentInput = z.object({
  sessionId: docId,
  paymentId: docId,
  reason: freeText.min(3),
  idempotencyKey,
});
export const closeDiningSessionInput = z.object({
  sessionId: docId,
  expectedVersion: z.number().int().min(0),
  managerExceptionReason: freeText.optional(),
});
export const rotateTableQrTokenInput = z.object({tableId: docId});

export type ResolveTableQrInput = z.infer<typeof resolveTableQrInput>;
export type SubmitGuestOrderInput = z.infer<typeof submitGuestOrderInput>;
export type SubmitWaiterOrderInput = z.infer<typeof submitWaiterOrderInput>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusInput>;
export type RecordManualPaymentInput = z.infer<typeof recordManualPaymentInput>;
export type ReverseManualPaymentInput = z.infer<typeof reverseManualPaymentInput>;
export type CloseDiningSessionInput = z.infer<typeof closeDiningSessionInput>;
export type RotateTableQrTokenInput = z.infer<typeof rotateTableQrTokenInput>;
export type CreateServiceRequestInput = z.infer<typeof createServiceRequestInput>;
export type ResolveServiceRequestInput = z.infer<typeof resolveServiceRequestInput>;

export type ResolveTableQrResult = {
  tableLabel: string;
  sessionId: string;
  capability: string;
  capabilityExpiresAt: number;
};

export type OrderLineSnapshot = {
  itemId: string;
  name: string;
  unitPriceMinor: number;
  quantity: number;
  optionIds: string[];
  optionsSnapshot: {id: string; name: string; priceDeltaMinor: number}[];
  notes: string;
  lineTotalMinor: number;
};

export type SubmitOrderResult = {orderId: string; status: OrderStatus; totalMinor: number};
export type UpdateOrderStatusResult = {status: OrderStatus; version: number};
export type RecordManualPaymentResult = {paymentId: string; balanceMinor: number};
export type ReverseManualPaymentResult = {reversalId: string; balanceMinor: number};
export type CloseDiningSessionResult = {closedAt: number};
export type CreateServiceRequestResult = {requestId: string};
export type ResolveServiceRequestResult = {requestId: string; resolvedAt: number};
export type RotateTableQrTokenResult = {tableId: string; printableQrPayload: string; tokenVersion: number};

export type GuestSessionView = {
  tableLabel: string;
  sessionId: string;
  /** Only the orders this guest capability submitted; see docs/04 privacy model. */
  orders: {
    orderId: string;
    status: OrderStatus;
    totalMinor: number;
    createdAt: number;
    items: {name: string; quantity: number; lineTotalMinor: number; notes: string}[];
  }[];
  ownTotalMinor: number;
  /**
   * Whether the table owes anything at all. A flag, not an amount: it gates the
   * "request the bill" action without disclosing what the rest of the party
   * spent. True when any guest at the table has an uncancelled order, so a
   * guest who has ordered nothing can still ask for the table's bill.
   */
  tableHasChargeableOrders: boolean;
};
