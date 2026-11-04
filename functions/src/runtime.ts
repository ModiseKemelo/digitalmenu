/**
 * Admin SDK initialisation, document references and small shared helpers.
 */
import type {ZodType} from 'zod';
import {initializeApp, getApps} from 'firebase-admin/app';
import {getFirestore, FieldValue, Timestamp} from 'firebase-admin/firestore';
import {HttpsError} from 'firebase-functions/v2/https';
import {REGION} from './runtime-region';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export {FieldValue, Timestamp};

export const RESTAURANT_ID = process.env.RESTAURANT_ID ?? 'bukhara';
/**
 * App Check is enforced everywhere except under the emulator, where no
 * attestation provider exists. It must never be disabled in a deployed
 * environment; see docs/04-SECURITY-AND-DATA.md.
 */
export const IS_EMULATOR = process.env.FUNCTIONS_EMULATOR === 'true';

/**
 * Origin baked into every QR payload (`${BASE_URL}/t/<token>`). A code minted
 * against the wrong origin is dead paper, so the deployed default must be the
 * real site rather than localhost; override with PUBLIC_BASE_URL when the
 * domain changes.
 */
export const BASE_URL =
  process.env.PUBLIC_BASE_URL ?? (IS_EMULATOR ? 'http://localhost:3000' : 'https://menu-bukhara.web.app');

export {REGION};

export const callableOptions = {enforceAppCheck: !IS_EMULATOR, region: REGION} as const;

/**
 * Branch-scoped document references.
 *
 * A branch is one restaurant location. Its operational data stays under
 * `restaurants/{branchId}`, so the Firestore rules — which already take a
 * restaurant id — keep working unchanged.
 */
const branchDoc = (branchId: string) => db.collection('restaurants').doc(branchId);

export const refsFor = (branchId: string) => ({
  branchId,
  restaurant: () => branchDoc(branchId),
  categories: () => branchDoc(branchId).collection('categories'),
  menuItems: () => branchDoc(branchId).collection('menuItems'),
  menuOverrides: () => branchDoc(branchId).collection('menuOverrides'),
  tables: () => branchDoc(branchId).collection('tables'),
  table: (tableId: string) => branchDoc(branchId).collection('tables').doc(tableId),
  sessions: () => branchDoc(branchId).collection('sessions'),
  session: (sessionId: string) => branchDoc(branchId).collection('sessions').doc(sessionId),
  orders: (sessionId: string) => branchDoc(branchId).collection('sessions').doc(sessionId).collection('orders'),
  order: (sessionId: string, orderId: string) =>
    branchDoc(branchId).collection('sessions').doc(sessionId).collection('orders').doc(orderId),
  payments: (sessionId: string) => branchDoc(branchId).collection('sessions').doc(sessionId).collection('payments'),
  payment: (sessionId: string, paymentId: string) =>
    branchDoc(branchId).collection('sessions').doc(sessionId).collection('payments').doc(paymentId),
  guestAccess: (sessionId: string) => branchDoc(branchId).collection('sessions').doc(sessionId).collection('guestAccess'),
  staff: (uid: string) => branchDoc(branchId).collection('staff').doc(uid),
  staffMembers: () => branchDoc(branchId).collection('staff'),
  serviceRequests: () => branchDoc(branchId).collection('serviceRequests'),
  guestCapabilitiesForBranch: () => db.collection('guestCapabilities').where('branchId', '==', branchId),
});

export type Refs = ReturnType<typeof refsFor>;

/**
 * References that are NOT scoped to a branch.
 *
 * QR tokens and guest capabilities are looked up by hash alone: a guest
 * scanning a printed card supplies only the token, so there is no branch to
 * scope the lookup to. They therefore live at the top level and carry a
 * `branchId` field, which is what tells the rest of a request which branch it
 * is operating on. Keeping the hash as the document id is also what lets
 * already-printed /t/<token> cards survive the move.
 *
 * Idempotency records, rate-limit buckets and audit logs are top level for a
 * different reason: their keys already include the owner, a rate limit on QR
 * guessing has to apply before any branch is known, and one audit trail across
 * branches is more useful to an administrator than several.
 */
export const globalRefs = {
  branches: () => db.collection('branches'),
  branch: (branchId: string) => db.collection('branches').doc(branchId),
  /** Hash -> table lookup, so a raw QR token is never stored or enumerable. */
  qrToken: (tokenHash: string) => db.collection('qrTokens').doc(tokenHash),
  /** Hash -> guest capability lookup, keyed by hash so the raw value is never stored. */
  capability: (capabilityHash: string) => db.collection('guestCapabilities').doc(capabilityHash),
  idempotency: (scopedKey: string) => db.collection('idempotency').doc(scopedKey),
  rateLimit: (key: string) => db.collection('rateLimits').doc(key),
  auditLogs: () => db.collection('auditLogs'),
};

/** The default branch, for the single-branch deployment and for scripts. */
export const DEFAULT_BRANCH_ID = RESTAURANT_ID;
export const refs = refsFor(DEFAULT_BRANCH_ID);

/** Structured error codes, so clients can react without parsing messages. */
export type ErrorCode =
  | 'invalid-request'
  | 'invalid-qr'
  | 'table-disabled'
  | 'capability-expired'
  | 'capability-revoked'
  | 'session-closed'
  | 'item-unavailable'
  | 'option-invalid'
  | 'version-conflict'
  | 'illegal-transition'
  | 'nothing-to-bill'
  | 'already-resolved'
  | 'balance-outstanding'
  | 'already-reversed'
  | 'rate-limited'
  | 'not-staff'
  | 'not-admin';

/**
 * Raises a structured error. Never call this inside a Firestore transaction
 * callback: return `txFail` from the transaction and `unwrap` it outside.
 */
export function fail(httpCode: HttpFailureCode, code: ErrorCode, message: string): never {
  throw new HttpsError(httpCode, message, {code});
}

export type HttpFailureCode =
  | 'invalid-argument'
  | 'permission-denied'
  | 'not-found'
  | 'failed-precondition'
  | 'aborted'
  | 'resource-exhausted'
  | 'unauthenticated'
  | 'internal';

/**
 * The outcome of a transaction body.
 *
 * Expected failures (a stale version, a closed session, a sold-out dish) are
 * returned rather than thrown. Throwing out of a `runTransaction` callback made
 * the SDK roll back and, when that rollback raced the closing transaction, emit
 * an unhandled "Transaction is invalid or closed" error that destabilised the
 * next request. The caller turns a failure into an HttpsError with `unwrap`,
 * outside the transaction.
 */
export type TxResult<T> = {ok: true; value: T} | {ok: false; httpCode: HttpFailureCode; code: ErrorCode; message: string};

export function txOk<T>(value: T): TxResult<T> {
  return {ok: true, value};
}

export function txFail(httpCode: HttpFailureCode, code: ErrorCode, message: string): TxResult<never> {
  return {ok: false, httpCode, code, message};
}

/** Converts a transaction outcome into a value or a structured HttpsError. */
export function unwrap<T>(result: TxResult<T>): T {
  if (result.ok) return result.value;
  fail(result.httpCode, result.code, result.message);
}

export function nowMs(): number {
  return Date.now();
}

/**
 * Validates a callable's payload. A schema failure is the client's fault, so it
 * must surface as invalid-argument with the offending fields named, never as an
 * opaque internal error.
 */
export function parseInput<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  throw new HttpsError('invalid-argument', 'The request was not valid', {
    code: 'invalid-request' satisfies ErrorCode,
    issues: result.error.issues.map((issue) => ({path: issue.path.join('.'), message: issue.message})),
  });
}

export type SessionDoc = {
  tableId: string;
  tableLabel: string;
  status: 'open' | 'closed';
  openedAt: Timestamp;
  closedAt: Timestamp | null;
  chargeTotalMinor: number;
  paidMinor: number;
  adjustmentsMinor: number;
  balanceMinor: number;
  version: number;
};
