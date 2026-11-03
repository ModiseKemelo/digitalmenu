# 04 — Security and data rules

## Current state (updated 2026-11-03)
Rules still deny **all client writes**, and that is now the permanent design: every
mutation goes through a Cloud Function that validates authorization, prices from
Firestore and writes in a transaction. The callables are implemented (see
`docs/09-API-CONTRACTS.md`) and covered by 16 rules tests and 43 integration
tests. Reads are narrow: published menu data is public, service data is
staff-only, and QR token hashes, guest capabilities and idempotency records are
unreadable by every client. App Check is enforced on every callable except under
the emulator, which has no attestation provider.

Outstanding: a dedicated Firebase project, App Check registration for the real
web app, backups, monitoring and a production retention policy.

## Authentication
Staff: Firebase Auth + active restaurant staff document + role check in server functions. Do not rely on UI-only role hiding. Guest: server-validated QR -> short-lived signed, HTTP-only secure SameSite cookie bound to current session; optional Firebase custom auth only if the client authorization model is explicitly redesigned. Cookie must not expose server secrets.

## Guest protection
QR table identity alone is not proof of membership in a specific dining party. Define explicit session join policy; prevent access to previous party data after table reset; use short TTL, revocation, anti-replay, App Check and rate limits. For a strict privacy model, guests only see their own submitted orders unless they explicitly join a shared table session.

## Finance
Store amounts in integer thebe, price snapshots per order, append-only payments and reversals, audit staff UID and server timestamps. Avoid hard deletes. Close session in a transaction after balance verification.

## Privacy
Collect minimum data; avoid names/phone numbers unless necessary. Define retention, export and deletion policies consistent with applicable Botswana law and restaurant obligations. Never store card PAN, CVV or PIN.

## Rules tests required — implemented
`tests/rules/firestore-rules.test.ts` (16 tests) covers: no client may write orders,
payments, menu, tables, sessions, staff or audit logs; a guest cannot read orders,
payments, sessions, tables, staff records or audit logs; unpublished menu data is
hidden from guests but visible to staff; a deactivated waiter loses access; a
signed-in non-staff user is refused; audit logs are admin-read-only; and QR
hashes, capabilities and idempotency records are unreadable by everyone.

`tests/integration/` (43 tests) covers invalid and rotated QR tokens, stale and
revoked capabilities, cross-party isolation, forged prices, unavailable items,
illegal status transitions, version conflicts, duplicate payments and closing
rules.
