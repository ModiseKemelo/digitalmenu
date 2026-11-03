# Implementation tracker — Bukhara Digital Menu

Status key: [ ] Not started | [~] Partially complete | [x] Verified complete.
**Do not mark complete without evidence.**

Verification commands (see `docs/11-FIREBASE-SETUP.md` for the required
`JAVA_HOME`/`PATH`, since the emulators need JDK 11 and Firebase CLI 13):

```bash
npm run verify          # lint, typecheck, unit tests, functions build, app build
npm run test:rules      # Firestore rules tests
npm run test:emulator   # callable / transaction integration tests
```

## Scaffold (provided)
- [x] S01 Project manifest, TypeScript config, preview pages — evidence: source files
- [x] S02 Safe-deny Firestore and Storage rules — evidence: rules files
- [x] S03 Cloud Functions placeholders (unimplemented by design) — superseded by M2/M3/M5
- [x] S04 Order-domain helper and unit test source — evidence: src/lib/order-domain.test.ts
- [x] S05 PRD, architecture, implementation and handoff docs — evidence: docs/

## Build and implementation

### M0 — Local setup — [~] mostly complete
- [x] Dependencies install; `npm install` succeeds — evidence: 1051 packages added
- [x] `npm run dev` serves the app — evidence: "Ready in 3.2s"; `/`, `/menu`, `/cart`,
      `/orders`, `/bill`, `/t/[token]`, `/staff`, `/staff/login`, `/admin` all return 200
- [x] `npm test` — 24/24 unit tests pass
- [x] `npm run typecheck` — clean (app and functions trees)
- [x] `npm run lint` — clean, 0 errors 0 warnings
- [x] `npm run build` — 16 routes compiled; `npm run build:functions` — clean
- [x] Emulator suite launches and runs tests — evidence: rules 16/16, integration 43/43
- [ ] **Separate dev/staging/prod Firebase projects** — NOT done. Currently reusing the
      shared `ashok-eatery` project; see the tenancy warning in docs/11-FIREBASE-SETUP.md
- [ ] Node 22 LTS — this machine runs Node 20.20.1 (works, but not the documented version)

### M1 — Branding and data — [~] tooling and UI done, data outstanding
- [ ] **Obtain approved menu CSV, images, allergen/options data, logo, table labels**
      — BLOCKED, not supplied
- [x] Firestore menu importer — evidence: `scripts/import-menu.ts`; decimal BWP parsed to
      integer thebe without float arithmetic; refuses to publish an item with no photo path
- [ ] Image variant pipeline — NOT done (no photographs supplied)
- [x] Category and dish cards, item detail, availability and search — evidence:
      `/menu`, `/menu/category/[id]`, `/menu/item/[id]`
- [ ] Responsive image performance tested on real devices — NOT done (no photos/devices)

### M2 — QR and guest security — [x] complete
- [x] Cryptographically random QR tokens, hashed server-side — evidence: 256-bit CSPRNG
      tokens in `functions/src/security.ts`; only SHA-256 hashes stored; test
      "never stores the raw token" passes
- [x] QR resolution and session capability issuance — evidence: `resolveTableQr`;
      one open session per table enforced transactionally, test
      "joins both guests at a table to one session"
- [x] Replay / cross-table / historical access prevented, rate limits — evidence: tests
      for unknown, disabled and rotated-out tokens; "revokes capabilities when the table
      is closed"; "scopes the session view to the guest's own orders"; sliding-window
      rate limiter with "creates a bill request and rate limits repeats"
- [x] Printable QR sheet and rotation workflow — evidence: `scripts/provision-tables.ts`
      writes per-table SVGs plus an A4 `qr-sheet.html`; `rotateTableQrToken` + `/admin/tables`;
      test "rotates a token, revoking the old one"

### M3 — Ordering — [x] complete
- [x] Cart, variants, notes, quantities, price display — evidence: `src/lib/cart.tsx`, `/cart`
- [x] Server validates capability and prices from Firestore — evidence:
      `functions/src/pricing.ts`; test "prices the order from Firestore, not the request"
      (a forged price of 1 thebe is ignored and the order totals 25000)
- [x] Firestore transaction for order, totals and idempotency — evidence: tests
      "returns the original order when a request is retried", "deduplicates concurrent
      retries of the same key", "keeps distinct orders from two guests at one table"
- [x] Guest sees confirmed order and live status; retries do not duplicate — evidence:
      `/order/confirmation`, `/orders`
- [x] Multi-device concurrency and failure tests — evidence: 43 integration tests

### M4 — Waiter operations — [~] built, not yet staff-tested
- [x] Firebase Auth login, role-based guards, staff activation — evidence: `/staff/login`,
      `src/components/StaffGuard.tsx`, `scripts/provision-staff.ts`; tests for
      unauthenticated, no-staff-record, deactivated and wrong-role callers
- [x] Real-time order dashboard with sound and badge alerts — evidence: `/staff`, Firestore
      snapshot listener, synthesised alert tone, unacknowledged-order badge
- [x] Status transitions restricted to the permitted graph — evidence: tests
      "walks an order through the service flow", "refuses a transition outside the graph",
      "rejects a stale expectedVersion", "limits late cancellation to an administrator"
- [~] QR scanner opens authenticated staff table view — table **picker** built
      (`/staff/scan`); camera scanning NOT built
- [~] Waiter submits assisted orders — `submitWaiterOrder` implemented and tested
      ("records an assisted order as accepted and attributed"), but there is **no UI**
      for a waiter to compose one yet
- [ ] Relay-to-kitchen workflow tested with actual staff — NOT done (needs staff UAT)

### M5 — Payments and administration — [~] payments complete, admin partial
- [x] Cash/card payments with reference and staff UID — evidence: `recordManualPayment`,
      `/staff/tables/[id]`; test "applies partial and split payments"
- [x] Partial/split payments and authorized reversals — evidence: tests
      "does not take the money twice for one key", "reverses a payment append-only and
      restores the balance", "refuses to reverse the same payment twice"; reversals are
      admin-only and append-only
- [x] Table closure checks balance transactionally — evidence: tests "refuses to close
      with an outstanding balance", "closes a settled table and frees it for the next
      party", "lets an administrator close an unsettled table with a written reason",
      "rejects a stale version when closing"
- [x] Staff actions attributed and auditable — evidence: test "attributes every
      privileged action"; append-only `auditLogs`, admin-read-only
- [~] Admin views — tables and QR rotation built (`/admin/tables`); **menu, media, staff,
      reporting and audit screens NOT built** (menu/staff run from CLI scripts)

### M6 — Launch — [ ] not started
- [x] Emulator rules tests — 16/16 pass
- [ ] Load tests, device tests, network tests
- [ ] Custom domain, TLS, backups, alerts, budgets, monitoring
- [ ] Staff training and printed QR labels verified
- [ ] Pilot 2–3 tables, then 20 after written sign-off

## Evidence log
| Date | Task ID | Commit | Test command/result | Evidence | Reviewer | Notes |
|---|---|---|---|---|---|---|
| 2026-11-03 | M0 | n/a (not a git repo) | `npm run lint` / `typecheck` / `test` / `build` — all pass | 24 unit tests; 16 routes built | unreviewed | Node 20, not 22; single shared Firebase project |
| 2026-11-03 | M2 | n/a | `npm run test:emulator` — 43/43 | QR tokens hashed; rotation revokes old token | unreviewed | |
| 2026-11-03 | M3 | n/a | `npm run test:emulator` — 43/43 | Server-side pricing; idempotent submit | unreviewed | |
| 2026-11-03 | M4 | n/a | `npm run test:emulator` — 43/43 | Role gates; version-checked transitions | unreviewed | Staff UAT outstanding |
| 2026-11-03 | M5 | n/a | `npm run test:emulator` — 43/43 | Append-only payments; transactional close | unreviewed | Admin screens partial |
| 2026-11-03 | rules | n/a | `npm run test:rules` — 16/16 | All client writes denied; secrets unreadable | unreviewed | |

**Total: 83 automated tests passing** (24 unit, 16 rules, 43 integration).
No work in this log has been reviewed by a second person, and nothing has been
deployed.

## Acceptance criteria status (docs/01-PRD.md)
| # | Criterion | Status |
|---|---|---|
| 1 | Each table QR resolves only its own table | Met, tested |
| 2 | Published items have approved photo, description, price, availability | Enforced by the importer; **awaiting real photos** |
| 3 | Multiple devices order into one session without overwrites | Met, tested |
| 4 | Server validates price, options, quantity, capability, idempotency | Met, tested |
| 5 | Orders reach staff in real time with alert fallback | Met (snapshot listener + tone/badge); not yet device-tested |
| 6 | Waiters add orders, change permitted statuses, record payments | Backend met; assisted-order UI missing |
| 7 | Closing requires zero balance or manager exception | Met, tested |
| 8 | Guests cannot read other tables, previous sessions or payments | Met, tested (rules + integration) |
| 9 | Staff actions attributed and auditable | Met, tested |
| 10 | Network failures never show false order success | Met (idempotent submit, explicit failure states); not yet tested on a real flaky network |

## Blockers
- **Actual Bukhara menu, pricing and photographs not supplied** — blocks M1 and
  publishing any item (the importer refuses to publish a photoless item).
- **Brand assets, exact table labels, staff names/roles and domain pending.**
- **No dedicated Firebase project.** The app points at the shared `ashok-eatery`
  project and no web app is registered there, so two values in `.env.local` are
  blank and a browser cannot reach the live project. Deploying this repository's
  rules to that project would break the other app that uses it.
- **Local toolchain is pinned to workarounds**: JDK 11 + Firebase CLI 13, with
  emulator ports moved off the defaults. Installing JDK 21 and the current CLI
  would remove this.
- ~~The integration suite occasionally stalls against the emulator~~ —
  **diagnosed and fixed.** The cause was a defect in this repository, not the
  environment: raising `HttpsError` inside a Firestore transaction callback left
  an unhandled "Transaction is invalid or closed" rollback error that
  destabilised the following request, failing one arbitrary test per run.
  Transaction bodies now return a result and raise outside the transaction.
  Three consecutive full runs pass 43/43 with no unhandled errors. The suite
  keeps one retry as a safety net.
