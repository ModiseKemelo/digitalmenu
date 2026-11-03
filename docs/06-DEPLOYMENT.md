# 06 — Deployment and operations

1. Create separate Firebase projects for development, staging and production; configure billing budgets and alerts.
2. Configure Firebase Auth providers, Firestore, Storage, App Check, Functions, and App Hosting.
3. Use environment-specific variables; secrets in managed secret store, never in git or `NEXT_PUBLIC_*`.
4. Run automated tests and emulator rules tests; deploy to staging first.
5. Verify production indexes, IAM, backups, logging, alerting, data retention, least-privilege and custom domain.
6. Run smoke tests with non-production tables; pilot 2–3 physical tables.
7. Obtain restaurant manager acceptance; gradually enable all 20 tables.
8. Monitor errors, failed orders, payment discrepancies, latency and storage costs daily during pilot.

## Rollback
Disable guest ordering via server-side feature flag; preserve all orders and payments; revert app deployment; reconcile any pending submissions; never roll back database blindly.

## Caution
Do not deploy current stub functions/rules as a live ordering system. Firebase project setup and hosting configuration must be finalized during implementation.
