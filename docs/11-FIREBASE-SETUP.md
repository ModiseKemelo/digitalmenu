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

## What is deployed

Deployed to `menu-bukhara` on 2026-11-03:

| Component | State |
|---|---|
| Firestore database | created, **`africa-south1`** (permanent — a location cannot be moved) |
| Firestore rules and indexes | deployed |
| Cloud Functions | all 11 callables, `africa-south1`, Node 22 |
| Cloud Storage | default bucket created in `africa-south1`; menu photographs uploaded |
| Authentication | Email/Password provider enabled |
| App Check | registered, reCAPTCHA **Enterprise**, enforced |
| Menu data | 16 categories, 155 items, all published with photographs |
| Tables | TBL-001 and TBL-002 provisioned with QR tokens |
| Front end | **not deployed** — runs locally; App Hosting needs an interactive step |

Billing is Blaze, confirmed: the CLI was able to enable services, which the
Spark plan refuses.

Verified end to end against the deployed project, not the emulator: App Check
debug token exchanged, `healthcheck`, `resolveTableQr`, `submitGuestOrder`
(priced server-side from Firestore at P337 for 2 x Butter Chicken + 3 x Garlic
Naan), an idempotent replay returning the same order id, and
`getGuestSessionView`.

### How the console-only steps were done

Firebase documents several of these as console clicks, which cannot be scripted
and were blocking. Each has an API that the CLI's own credentials can reach, so
they were done over the API instead and are reproducible:

| Step | API |
|---|---|
| Enable a service | `firebase-tools/lib/ensureApiEnabled` with the CLI's auth |
| Initialise Auth | `identitytoolkit.googleapis.com/v2/projects/{p}/identityPlatform:initializeAuth` |
| Enable Email/Password | `PATCH admin/v2/projects/{p}/config?updateMask=signIn.email` |
| Create the Storage bucket | `POST firebasestorage.googleapis.com/v1beta/projects/{p}/defaultBucket` |
| Create a reCAPTCHA key | `POST recaptchaenterprise.googleapis.com/v1/projects/{p}/keys` |
| Register App Check | `PATCH firebaseappcheck.../apps/{appId}/recaptchaEnterpriseConfig` |
| Register a debug token | `POST firebaseappcheck.../apps/{appId}/debugTokens` |

### App Check

Enforced. `functions/src/runtime.ts` sets `enforceAppCheck: true` whenever the
functions are not under the emulator, and the client attests with **reCAPTCHA
Enterprise** — the provider registered against this web app. The provider on
the client must match the registration, or attestation fails with no useful
error in the browser.

The site key in `apphosting.yaml` and `.env.local` is public by design: it is
embedded in every page that loads reCAPTCHA, and the paired secret stays with
Google. The key currently allows all domains, because the App Hosting domain is
not known yet; **narrow it to the real domains before launch**.

A debug token is registered so this machine can call the live project. It lives
in `.env.local` only, never in `apphosting.yaml`, and must never reach a
deployed environment.

### Region choice

Functions, Firestore and Storage are all in `africa-south1` (Johannesburg), the
nearest Google region to Gaborone; `us-central1` adds roughly 200ms to every
order and status change. The region is set once in
`functions/src/runtime-region.ts` and read by the client through
`NEXT_PUBLIC_FUNCTIONS_REGION` — **if the two disagree every callable 404s.**

Node 22 is the deployed runtime because Node 20 was decommissioned on
2026-10-31. This machine builds on Node 20.20.1, so the build host and the
target differ; installing Node 22 locally would align them.

### Still one project, not three

`docs/06-DEPLOYMENT.md` requires separate dev/staging/prod projects.
`menu-bukhara` is currently all three, and it now holds live menu data and
working QR tokens. Create `menu-bukhara-staging` and `menu-bukhara-prod` before
the pilot, so that a developer machine cannot reach live tables.

### Finishing the App Hosting deploy

`firebase apphosting:backends:create` cannot be scripted: it requires an
interactive terminal and a browser authorisation to link a GitHub repository
through Developer Connect. The repository is committed locally but has no
remote, and `gh` is not installed here.

App Hosting has no African region. Available locations are `asia-east1`,
`asia-southeast1`, `europe-west4`, `us-central1`, `us-east4`, `us-east5`;
**`europe-west4`** is the closest usable one for Southern Africa. This only
affects delivery of the initial HTML, which is CDN-cached — the ordering path
runs browser to `africa-south1` either way.

1. Push the repository to GitHub (private — it carries table and QR tooling).
2. Then, in a real terminal:

```bash
export PATH="/home/max/.local/firebase-cli/node_modules/.bin:$PATH"
firebase apphosting:backends:create \
  --project menu-bukhara \
  --location europe-west4 \
  --app 1:642414941918:web:d1868c9e6eb4936e86944f
```

`apphosting.yaml` already carries the build and runtime configuration.

3. Afterwards, point `NEXT_PUBLIC_BASE_URL` in `apphosting.yaml` at the real
   backend URL and redeploy **before minting any QR codes for print** — that
   value is baked into every QR payload (`${BASE_URL}/t/<token>`), so codes
   printed against the wrong origin are dead paper. The two tables provisioned
   so far point at `http://localhost:3000` and will need rotating.

## Running it locally against the live project

`.env.local` has `NEXT_PUBLIC_USE_EMULATORS=false`, so `npm run dev` talks to
the deployed backend. Test accounts and the table URLs are in
`.local/test-credentials.txt`, which is gitignored.

To go back to the emulator, set `NEXT_PUBLIC_USE_EMULATORS=true`.

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
| `npm run deploy:rules` | push Firestore rules, indexes and storage rules |
| `npm run deploy:functions` | build and deploy the callables |
| `firebase apphosting:rollouts:create <backend> -b main` | redeploy the front end |

The provisioning scripts refuse to write to a live project unless
`I_UNDERSTAND_THIS_WRITES_TO_A_REAL_PROJECT=yes` is set; otherwise point them at
the emulator with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085`.
