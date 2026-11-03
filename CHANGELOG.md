# Changelog

## 0.2.0 — 2026-11-03

Implemented the secure ordering core, the guest and staff interfaces, and the
provisioning tooling. **Still not production ready**: no approved menu or
photographs, no dedicated Firebase project, and no staff UAT or sign-off. See
TRACKING.md for per-task status and evidence.

### Server (Cloud Functions)
- Replaced the UNIMPLEMENTED placeholders with nine callables: `resolveTableQr`,
  `submitGuestOrder`, `getGuestSessionView`, `createServiceRequest`,
  `submitWaiterOrder`, `updateOrderStatus`, `recordManualPayment`,
  `reverseManualPayment`, `closeDiningSession` and `rotateTableQrToken`.
- QR tokens and guest capabilities are 256-bit CSPRNG values stored only as
  SHA-256 hashes, and are revocable.
- Orders are priced from Firestore inside the transaction that writes them;
  client-supplied money is never read.
- Every order, payment and reversal is idempotent under a scoped key, and every
  privileged action writes an append-only audit entry.
- One open session per table, maintained transactionally.
- Sliding-window rate limiting on QR resolution, ordering and service requests.

### Client
- Guest flow: QR landing, menu, category, dish detail with options and notes,
  cart, confirmation, live order status, and bill/assistance requests.
- Staff: sign-in, live order dashboard over a Firestore listener with sound and
  badge alerts, table picker, and a table screen for payments, reversals and
  closing.
- Admin: table list with QR rotation.

### Rules and data
- Firestore rules deny all client writes; published menu data is public, service
  data is staff-only, and QR hashes, capabilities and idempotency records are
  unreadable by every client.
- Indexes added for the live order feed, the guest's own orders, open sessions
  and service requests.

### Removed
- `src/lib/demo-menu.ts` (illustrative placeholder data), superseded by real
  Firestore menu reads in `src/lib/menu-data.ts`.

### Tooling
- `scripts/import-menu.ts` imports the approved menu CSVs, converting decimal
  BWP to integer thebe without float arithmetic and refusing to publish an item
  with no photograph.
- `scripts/provision-tables.ts` provisions tables, mints QR tokens and writes
  printable SVG labels plus an A4 sheet.
- `scripts/provision-staff.ts` creates and deactivates staff accounts.
- 83 automated tests: 24 unit, 16 Firestore rules, 43 emulator integration.
- `npm run verify` runs lint, typecheck, unit tests and both builds.

### Fixed during implementation
- `submitWaiterOrder` read from Firestore after writing within a transaction,
  which failed for an idle table; session resolution is now an explicit read
  phase followed by a write phase.
- Schema rejections surfaced as opaque `internal` errors; they now return
  `invalid-argument` with the offending fields named.
- The rate limiter used a fixed window, which handed a caller a fresh allowance
  immediately after the boundary; it is now a sliding window.
- Expected failures were raised with `HttpsError` from inside Firestore
  transaction callbacks. The SDK then attempted a rollback that could fail with
  "Transaction is invalid or closed", leaving an unhandled error that
  intermittently destabilised the next request and made one arbitrary
  integration test fail per run. Transaction bodies now return a `TxResult` and
  the error is raised outside the transaction; three consecutive full runs pass
  with no unhandled errors.

## 0.1.0 — 2026-11-03
Initial development scaffold and handoff documentation. No live ordering or
payment functionality implemented.
