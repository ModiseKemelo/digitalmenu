# 05 — Testing and acceptance

## Test layers
- Unit: order state machine, money, modifiers, quantity and idempotency key validation.
- Integration: Firestore emulator rules, Functions with Auth/App Check and transaction concurrency.
- E2E: QR -> menu -> cart -> submit -> waiter alert -> served -> payment -> close.
- Devices: Android Chrome, iPhone Safari, tablet; slow 4G and offline/reconnect.
- Security: forged prices, stale QR, cross-table access, unauthorized staff, replay and race conditions.
- Finance: partial/split payments, duplicate requests, reversals, mismatched totals.

## Test cases
T01 valid QR opens correct table; T02 unknown/disabled QR fails safely; T03 unpublished item not orderable; T04 simultaneous guests create distinct orders; T05 retry preserves one order; T06 staff receives update; T07 waiter changes allowed status only; T08 guest cannot see other table; T09 partial payment updates balance; T10 duplicate payment not applied twice; T11 settled table closes; T12 new party cannot access old orders; T13 offline order does not falsely confirm; T14 media loads efficiently; T15 staff role revocation takes effect.

## Exit gate
All critical T01–T15 tests pass, photos/prices approved, 20 QR labels scanned, reconciliation signed off, recovery/rollback rehearsed. Record evidence paths and reviewer in TRACKING.md.
