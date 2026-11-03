# 10 — Repository map

`src/app/`: Next.js pages (guest, staff, admin); `src/components/`: shared UI and the staff/guest guards; `src/lib/`: contracts, domain logic, Firebase client, API wrappers, cart and menu reads; `functions/src/`: Cloud Functions (`guest`, `staff`, `admin`, `pricing`, `sessions`, `security`, `runtime`); `scripts/`: menu, table/QR and staff provisioning; `tests/rules/` and `tests/integration/`: emulator test suites; `firestore.rules`, `storage.rules`, `firestore.indexes.json`: database policy and indexes; `templates/`: CSV intake; `docs/`: specifications/runbooks; `TRACKING.md`: milestone evidence; `.env.example`: non-secret configuration template.

## Files intentionally absent
`node_modules/`, build output, real Firebase credentials, actual Bukhara photos, real menu and QR secrets. These are generated or provided later.
