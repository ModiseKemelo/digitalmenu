# 02 — Architecture

Browser PWA (Next.js) -> public menu reads and controlled Cloud Functions -> Firestore/Storage. Staff uses Firebase Auth; server verifies staff record and role on every privileged mutation. Guests receive short-lived session-bound secure credentials after QR token validation; QR alone must never authorize historic order access.

## Proposed modules
- `src/app`: guest, waiter, admin pages.
- `src/lib`: Firebase client, money/status domain logic.
- `functions/src`: privileged server operations (currently safe placeholders).
- Firestore: `restaurants/{restaurantId}/categories`, `menuItems`, `tables`, `sessions/{id}/orders`, `payments`, `guestAccess`, `staff`, `serviceRequests`, `auditLogs`.

## Transactional invariants
- One active dining session per table, maintained transactionally.
- Price and line totals are server-derived in integer thebe.
- Every create-order request has unique idempotency key scoped to session.
- Every payment/reversal is append-only and audited.
- Session balance equals charge total minus valid payment entries and approved adjustments.
- Staff can only transition orders along explicit state graph.
- QR tokens are random, opaque, revocable and stored hashed; public tokens never enumerate tables.

## Suggested integration boundaries
Guest menu reads may use Firestore published records; protected guest order/session reads should be via session-scoped API. Admin media uploads require server-issued permissions or signed URLs. Production uses App Check, throttling, monitoring and backups.
