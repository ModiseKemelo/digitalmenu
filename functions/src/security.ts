/**
 * Server-only security primitives: opaque token minting, hashing, staff
 * authorization, idempotency and rate limiting.
 *
 * Raw tokens exist only in transit and in the QR print payload. Firestore only
 * ever holds their SHA-256 hash, so a database leak cannot be replayed as a
 * guest or table credential (docs/04-SECURITY-AND-DATA.md).
 */
import {randomBytes, createHash, timingSafeEqual} from 'node:crypto';
import type {CallableRequest} from 'firebase-functions/v2/https';
import type {Transaction} from 'firebase-admin/firestore';
import {db, refsFor, globalRefs, fail, FieldValue, Timestamp, nowMs, DEFAULT_BRANCH_ID, type Refs} from './runtime';
import {GUEST_CAPABILITY_TTL_MS, type StaffRole} from '../../src/lib/contracts';

const TOKEN_BYTES = 32;

/** 256 bits of CSPRNG entropy, URL-safe so it can live in a QR path segment. */
export function mintToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** Constant-time compare for any secret we do hold in memory. */
export function secretEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type StaffContext = {uid: string; role: StaffRole; name: string; branchId: string; refs: Refs};

/**
 * A Firebase Auth user is not staff. Membership and role are read from the
 * restaurant's staff collection on every privileged call, so deactivating a
 * staff document revokes access immediately (T15) without waiting for a token
 * to expire.
 */
export async function requireStaff(request: CallableRequest, branchId = DEFAULT_BRANCH_ID): Promise<StaffContext> {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', 'not-staff', 'Staff sign-in required');
  // Membership is per branch: a staff document exists in each branch the
  // person may work in, so holding several is how an administrator covers more
  // than one location, and losing one revokes exactly that location.
  const refs = refsFor(branchId);
  const snapshot = await refs.staff(uid).get();
  if (!snapshot.exists) fail('permission-denied', 'not-staff', 'No staff record for this account');
  const data = snapshot.data() as {active?: boolean; role?: StaffRole; name?: string};
  if (data.active !== true) fail('permission-denied', 'not-staff', 'Staff account is not active');
  if (data.role !== 'waiter' && data.role !== 'admin') fail('permission-denied', 'not-staff', 'Staff role is not recognised');
  return {uid, role: data.role, name: data.name ?? uid, branchId, refs};
}

export async function requireAdmin(request: CallableRequest, branchId = DEFAULT_BRANCH_ID): Promise<StaffContext> {
  const staff = await requireStaff(request, branchId);
  if (staff.role !== 'admin') fail('permission-denied', 'not-admin', 'Administrator role required');
  return staff;
}

export type GuestContext = {branchId: string; refs: Refs; sessionId: string; guestId: string; tableId: string};

/**
 * Resolves a raw guest capability to its session. Expired or revoked
 * capabilities are rejected, which is what stops a new party at the same table
 * from reading the previous party's orders (T12).
 */
export async function requireGuest(capability: string): Promise<GuestContext> {
  const snapshot = await globalRefs.capability(hashToken(capability)).get();
  if (!snapshot.exists) fail('permission-denied', 'capability-revoked', 'Guest session is no longer valid');
  const data = snapshot.data() as {
    branchId?: string;
    sessionId: string;
    guestId: string;
    tableId: string;
    expiresAt: Timestamp;
    revoked: boolean;
  };
  if (data.revoked) fail('permission-denied', 'capability-revoked', 'Guest session was closed');
  if (data.expiresAt.toMillis() <= nowMs()) fail('permission-denied', 'capability-expired', 'Guest session expired; rescan the table QR code');
  // Capabilities issued before the branch migration carry no branchId; they
  // belong to the original branch by definition.
  const branchId = data.branchId ?? DEFAULT_BRANCH_ID;
  return {branchId, refs: refsFor(branchId), sessionId: data.sessionId, guestId: data.guestId, tableId: data.tableId};
}

/** Issues a fresh capability for a session. Returns the raw value exactly once. */
export function issueCapability(
  tx: Transaction,
  input: {branchId: string; sessionId: string; tableId: string},
): {capability: string; guestId: string; expiresAtMs: number} {
  const refs = refsFor(input.branchId);
  const capability = mintToken();
  const guestId = refs.guestAccess(input.sessionId).doc().id;
  const expiresAtMs = nowMs() + GUEST_CAPABILITY_TTL_MS;
  const expiresAt = Timestamp.fromMillis(expiresAtMs);

  tx.set(globalRefs.capability(hashToken(capability)), {
    branchId: input.branchId,
    sessionId: input.sessionId,
    tableId: input.tableId,
    guestId,
    issuedAt: FieldValue.serverTimestamp(),
    expiresAt,
    revoked: false,
  });
  tx.set(refs.guestAccess(input.sessionId).doc(guestId), {
    issuedAt: FieldValue.serverTimestamp(),
    expiresAt,
    revoked: false,
  });

  return {capability, guestId, expiresAtMs};
}

/**
 * Sliding-window rate limit: at most `limit` hits in any `windowMs` period.
 *
 * A fixed window was tried first and rejected: it resets abruptly, so a caller
 * who hits the cap just before the boundary gets a full fresh allowance
 * immediately after, which made the limit unreliable at exactly the moment it
 * matters. Only the last `limit` timestamps are kept, so the document stays
 * small.
 *
 * The rejection is thrown outside the transaction: an error raised inside one
 * would abort the write that records the attempt.
 */
export async function consumeRateLimit(key: string, limit: number, windowMs: number): Promise<void> {
  const ref = globalRefs.rateLimit(createHash('sha256').update(key).digest('hex'));
  const allowed = await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const now = nowMs();
    const previous = snapshot.exists ? ((snapshot.data() as {hits?: number[]}).hits ?? []) : [];
    const recent = previous.filter((at) => now - at < windowMs);
    if (recent.length >= limit) return false;
    tx.set(ref, {hits: [...recent, now].slice(-limit), updatedAt: FieldValue.serverTimestamp()});
    return true;
  });
  if (!allowed) fail('resource-exhausted', 'rate-limited', 'Too many attempts; try again shortly');
}

/**
 * Scopes an idempotency key so one client's key cannot collide with or
 * overwrite another scope's record.
 */
export function scopeIdempotencyKey(scope: string, owner: string, key: string): string {
  return createHash('sha256').update(`${scope}\u0000${owner}\u0000${key}`).digest('hex');
}

/**
 * Reads a stored idempotent result inside a transaction. Must be called before
 * any write in that transaction.
 */
export async function readIdempotentResult<T>(tx: Transaction, scopedKey: string): Promise<T | undefined> {
  const snapshot = await tx.get(globalRefs.idempotency(scopedKey));
  if (!snapshot.exists) return undefined;
  return (snapshot.data() as {result: T}).result;
}

export function writeIdempotentResult<T>(tx: Transaction, scopedKey: string, scope: string, result: T): void {
  tx.set(globalRefs.idempotency(scopedKey), {scope, result, createdAt: FieldValue.serverTimestamp()});
}

/** Append-only attribution for every privileged mutation. */
export function audit(
  tx: Transaction,
  entry: {
    branchId?: string;
    action: string;
    actorType: 'guest' | 'staff' | 'system';
    actorId: string;
    targetPath?: string;
    detail?: Record<string, unknown>;
  },
): void {
  // One trail across branches is more useful to an administrator than one per
  // branch, so the entry records which branch it belongs to and the rules gate
  // reads on that field.
  tx.set(globalRefs.auditLogs().doc(), {
    branchId: DEFAULT_BRANCH_ID,
    ...entry,
    at: FieldValue.serverTimestamp(),
  });
}
