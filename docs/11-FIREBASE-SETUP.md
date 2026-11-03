# 11 — Firebase setup (as configured)

## Project

The Firebase project is **`menu-bukhara`**, dedicated to this app.

| Setting | Value |
|---|---|
| Project ID | `menu-bukhara` |
| Project number / messaging sender ID | `642414941918` |
| Web app ID | `1:642414941918:web:d1868c9e6eb4936e86944f` |
| Auth domain | `menu-bukhara.firebaseapp.com` |
| Storage bucket | `menu-bukhara.firebasestorage.app` |
| Analytics measurement ID | `G-3LG428KRY1` (not used; the app loads no analytics SDK) |

`.firebaserc` points `default` and `dev` at this project. `.env.local` holds the
same values and is gitignored. The web `apiKey` is a project identifier rather
than a secret — it is compiled into the browser bundle by design, and access is
controlled by `firestore.rules`, App Check and the callables' own auth checks.

Data is still namespaced under `restaurants/bukhara/**`, matching
`firestore.rules` and the `refs` map in `functions/src/runtime.ts`. Keep that
shape: a second venue becomes `restaurants/<id>/**` with no code change.

### Still one project, not three

`docs/06-DEPLOYMENT.md` requires separate dev/staging/prod projects.
`menu-bukhara` is currently all three. Create `menu-bukhara-staging` and
`menu-bukhara-prod` (or equivalent) and add them to `.firebaserc` before the
pilot, so that `npm run deploy:rules` and the provisioning scripts cannot reach
live tables from a developer machine.

### App Check is required before the live project works

`functions/src/runtime.ts` sets `enforceAppCheck: true` whenever the functions
are not running under the emulator. The browser therefore needs an App Check
token, or **every callable is rejected before it reaches our code** — the guest
would get an opaque failure on scanning a QR code.

The client initialises App Check with reCAPTCHA v3 when
`NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY` is set, and both entry points refuse to
start with a clear message when it is not. To finish the wiring:

1. Firebase console -> App Check -> register the web app with the
   **reCAPTCHA v3** provider.
2. Paste the site key into `NEXT_PUBLIC_RECAPTCHA_V3_SITE_KEY` in `.env.local`.
3. For a developer machine, add a debug token (console -> App Check -> Manage
   debug tokens) and set `NEXT_PUBLIC_APP_CHECK_DEBUG_TOKEN`. Never set that in
   production.

Leave enforcement on. Turning it off in `runtime.ts` would expose the guest
callables — which are reachable with only a QR capability — to scripted abuse.

### Services to enable in the console

None of these can be set from this repository:

- **Authentication** -> Email/Password provider (staff sign-in).
- **Cloud Firestore** -> create the database, `africa-south1` or the nearest
  region to Gaborone. Functions are pinned to `us-central1`; moving them closer
  is a latency win worth taking before launch.
- **Cloud Storage** -> default bucket (menu photographs).
- **Blaze plan** — Cloud Functions v2 requires it.

## Local toolchain

The emulators need a Firebase CLI and a JDK, and this machine needs specific
versions of both:

- **Firebase CLI 13.x**, installed in its own prefix at
  `/home/max/.local/firebase-cli`. It is deliberately *not* a dependency of this
  project: `firebase-tools` bundles its own `glob`/`lru-cache`, and installing it
  here broke the app's dependency tree. CLI 14+ and 15+ **require JDK 21**,
  which this machine does not have, so they cannot start the emulators.
- **JDK 11** at `/usr/lib/jvm/java-11-openjdk-amd64`. The default `java` on the
  PATH is JDK 8, which the Firestore emulator refuses.
- **Emulator ports moved off the defaults**: port 8080 is already in use on this
  machine, so `firebase.json` uses Firestore 8085, Auth 9100, Functions 5002,
  Storage 9198 and UI 4001. `src/lib/firebase-client.ts` and the test harness
  use the same numbers.

Run the emulator suites with both on the PATH:

```bash
export JAVA_HOME=/usr/lib/jvm/java-11-openjdk-amd64
export PATH="/home/max/.local/firebase-cli/node_modules/.bin:$JAVA_HOME/bin:$PATH"
npm run test:rules
npm run test:emulator
```

Installing JDK 21 and the current CLI would remove these constraints and is the
recommended fix before deployment work begins.

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | lint, typecheck, unit tests, both builds |
| `npm test` | unit tests only (no emulator needed) |
| `npm run test:rules` | Firestore rules tests against the emulator |
| `npm run test:emulator` | callable/transaction integration tests |
| `npm run emulators` | start the emulator suite for local development |
| `npm run import:menu` | import the approved menu CSVs |
| `npm run qr:provision` | provision tables, mint QR tokens, write the print sheet |
| `npm run staff:provision` | create or deactivate a staff account |

The provisioning scripts refuse to write to a live project unless
`I_UNDERSTAND_THIS_WRITES_TO_A_REAL_PROJECT=yes` is set; otherwise point them at
the emulator with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`.
