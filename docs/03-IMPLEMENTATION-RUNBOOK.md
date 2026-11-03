# 03 — Traceable implementation runbook

Each task: implement -> unit/integration tests -> screenshots/log evidence -> reviewer sign-off -> update TRACKING.md. Do not skip security gates.

## M0 — Local setup
- [x] Firebase CLI, Git installed; `npm install` succeeds. (Node 20.20.1, not 22.)
- [x] `npm run dev` serves the app; every route returns 200.
- [x] `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all pass.
- [ ] Firebase dev/staging/prod projects created — NOT done, see docs/11. Emulator launches: [x]
Evidence: terminal output, commit hash, reviewer.

## M1 — Branding and data
- [ ] Obtain approved menu CSV, images, allergen/options data, logo and table labels. BLOCKED.
- [x] Firestore menu importer (`scripts/import-menu.ts`). [ ] Image variant pipeline.
- [x] Category and dish cards, item detail, availability and search.
- [ ] Test responsive image performance on real devices. Needs photos and devices.
Evidence: menu approval sheet and screenshots.

## M2 — QR and guest security
- [x] Cryptographically random QR tokens; only SHA-256 hashes stored.
- [x] QR resolution and short-lived session capability issuance.
- [x] Replay, cross-table and historical access prevented; sliding-window rate limits.
- [x] Printable SVG labels and A4 sheet; rotation callable and admin screen.
Evidence: security tests and print scan tests.

## M3 — Ordering
- [x] Cart, variants, notes, quantities and price display.
- [x] Callable validates the capability and prices from Firestore; client totals ignored.
- [x] One transaction per order, with a scoped idempotency key.
- [x] Confirmation and live status screens; retries return the original order.
Evidence: multi-device concurrency and failure tests.

## M4 — Waiter operations
- [x] Firebase Auth login, role-based guards, staff activation/deactivation.
- [~] Table picker opens the authenticated staff table view; camera scanning not built.
- [x] Real-time order dashboard with sound and unacknowledged-order badge.
- [~] Status updates and acknowledgement built; assisted-order API done but no UI yet.
- [ ] Waiter relay-to-kitchen workflow tested with actual staff. Needs UAT.
Evidence: staff UAT videos/screenshots.

## M5 — Payments and administration
- [x] Cash/card payments recorded with reference and staff UID.
- [x] Partial and split payments; admin-only append-only reversals.
- [x] Closure verifies the balance in a transaction and revokes guest access.
- [~] Tables and QR screens built; menu, media, staff, reporting and audit views not built.
Evidence: reconciliation spreadsheet and role tests.

## M6 — Launch
- [~] Emulator rules tests pass (16/16); load, device and network tests not run.
- [ ] Configure custom domain, TLS, backups, alerts, budgets and monitoring.
- [ ] Staff training and printed QR labels verified.
- [ ] Pilot 2–3 tables, then 20 after written sign-off.
Evidence: acceptance report, rollback drill and sign-off.
