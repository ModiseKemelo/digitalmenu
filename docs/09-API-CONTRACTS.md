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
- `recordManualPayment({sessionId,amountMinor,tipMinor?,method:'cash'|'card',reference,idempotencyKey})` -> `{paymentId,balanceMinor,tipTotalMinor}`. Staff-only, append-only. `tipMinor` is optional and additional to `amountMinor`: it is tracked in `session.tipTotalMinor` and never settles the bill. Reversing a payment reverses its tip.
- `reverseManualPayment({paymentId,reason})` -> `{reversalId}`. Admin-only.
- `closeDiningSession({sessionId,expectedVersion})` -> `{closedAt}`. Staff-only; zero balance, or any balance with a written reason recorded in the audit trail.
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
