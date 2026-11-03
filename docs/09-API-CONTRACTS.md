# 09 — API contracts (IMPLEMENTED)

Implemented in `functions/src/`, with the request schemas defined once in
`src/lib/contracts.ts` and shared by the client and the server. Every callable
validates with Zod, re-checks authorization server-side, and returns structured
error codes in `details.code`. Covered by the integration suite.

All privileged actions: callable HTTPS Functions or Next.js server routes with equivalent server authorization; use Zod schemas, server timestamps, App Check and rate limits. Never trust client totals or role claims.

- `resolveTableQr({token})` -> `{tableLabel, shortLivedGuestCapability}`. Validate token and session policy; no historical data.
- `submitGuestOrder({capability,items:[{itemId,quantity,optionIds,notes}],idempotencyKey})` -> `{orderId,status,totalMinor}`. Validate and price server-side, transactionally deduplicate.
- `submitWaiterOrder({tableId,items,idempotencyKey})` -> `{orderId}`. Require active waiter/admin.
- `updateOrderStatus({orderId,nextStatus,expectedVersion})` -> `{status,version}`. Validate state transition.
- `createServiceRequest({capability,type:'bill'|'assistance'})` -> `{requestId}`. Limit repeats.
- `recordManualPayment({sessionId,amountMinor,method:'cash'|'card',reference,idempotencyKey})` -> `{paymentId,balanceMinor}`. Staff-only, append-only.
- `reverseManualPayment({paymentId,reason})` -> `{reversalId}`. Admin-only.
- `closeDiningSession({sessionId,expectedVersion})` -> `{closedAt}`. Staff-only; zero balance or manager exception.
- `rotateTableQrToken({tableId})` -> `{printableQrPayload}`. Admin-only; revoke old token.

All errors return structured codes in `details.code` (`invalid-request`,
`invalid-qr`, `table-disabled`, `capability-expired`, `capability-revoked`,
`session-closed`, `item-unavailable`, `option-invalid`, `version-conflict`,
`illegal-transition`, `balance-outstanding`, `already-reversed`, `rate-limited`,
`not-staff`, `not-admin`). Idempotent retries return the original result.
Firestore transactions enforce the invariants; note that a transaction must
complete all reads before any write, so session resolution is split into
`readTableSession` then `ensureSession`.

Additionally implemented beyond the original list: `getGuestSessionView({capability})`
returns the guest's own orders for the current session only.
