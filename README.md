# Bukhara Digital Menu

Mobile-first digital menu and table ordering for Bukhara Restaurant, Gaborone.
Next.js front end, Firebase back end, manual (cash/card) settlement by waiters.

**Status: the secure ordering core is implemented and tested, but this is not
production ready.** The approved Bukhara menu and photographs have not been
supplied, there is no dedicated Firebase project, and no staff acceptance
testing or sign-off has happened. Do not take live orders with it yet. See
`TRACKING.md` for per-task status and evidence, and `docs/11-FIREBASE-SETUP.md`
for the two configuration values still missing.

## What works

- **Guest**: scan a table QR, browse categories and dishes, pick options, add
  notes, order, watch the status live, request the bill or a waiter.
- **Waiter**: sign in, see new orders arrive without refreshing (with a sound
  and badge alert), advance them through the service flow, record cash and card
  payments including partial ones, and close a settled table.
- **Admin**: review tables and replace a table's QR code.
- **Server**: every price is calculated from Firestore, every order and payment
  is idempotent, every balance is derived in a transaction, and every privileged
  action is attributed in an append-only audit log.

## What does not work yet

Real menu data and photographs, an image pipeline, a camera QR scanner, a UI for
waiter-entered orders, and the admin screens for menu, media, staff and
reporting. Menu and staff administration is done from the command line for now.

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000
npm run verify       # lint, typecheck, unit tests, functions build, app build
```

The emulator suites need JDK 11 and Firebase CLI 13 on the PATH — this machine's
default `java` is JDK 8 and the newest CLI requires JDK 21. `docs/11-FIREBASE-SETUP.md`
has the exact exports.

```bash
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
export PATH="/home/max/.local/firebase-cli/node_modules/.bin:$JAVA_HOME/bin:$PATH"
npm run test:rules      # 16 Firestore rules tests
npm run test:emulator   # 43 callable and transaction tests
npm run emulators       # emulator suite for local development
```

Emulator ports are off the Firebase defaults (Firestore 8085, Auth 9100,
Functions 5002, Storage 9198, UI 4001) because port 8080 is already in use here.

## Provisioning

```bash
npm run import:menu -- --items templates/menu-items.csv --categories templates/categories.csv --dry-run
npm run qr:provision -- --tables templates/tables.csv --out .local/qr
npm run staff:provision -- --email waiter@example.com --name "Name" --role waiter
```

These refuse to touch a live project unless
`I_UNDERSTAND_THIS_WRITES_TO_A_REAL_PROJECT=yes` is set; otherwise point them at
the emulator with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`.

`qr:provision` writes live table credentials to `.local/` (gitignored). A table's
raw QR token is shown exactly once, when it is minted, because only its hash is
stored.

## Reading order

`docs/00-START-HERE.md` · `01-PRD` · `02-ARCHITECTURE` ·
`03-IMPLEMENTATION-RUNBOOK` · `04-SECURITY-AND-DATA` ·
`05-TESTING-AND-ACCEPTANCE` · `06-DEPLOYMENT` · `07-HANDOFF-TO-DESKTOP` ·
`08-SCREEN-INVENTORY` · `09-API-CONTRACTS` · `10-REPOSITORY-MAP` ·
`11-FIREBASE-SETUP` · `TRACKING.md`

## Safety

Never commit `.env.local`, `.local/`, service account keys, customer details or
payment references. Firestore denies every client write: all mutations go through
the Cloud Functions. Card PANs, CVVs and PINs are never stored. All prices are
integer thebe.
