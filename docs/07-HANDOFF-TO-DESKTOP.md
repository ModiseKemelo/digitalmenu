# 07 — Desktop implementation handoff

Open this extracted project folder in VS Code / ChatGPT Desktop. Start a new session with:

> We are implementing Bukhara Digital Menu. Read README.md, docs/00-START-HERE.md, docs/03-IMPLEMENTATION-RUNBOOK.md, docs/04-SECURITY-AND-DATA.md and TRACKING.md first. Do not assume unimplemented features work. Work on the first unchecked milestone, run tests, record evidence and update TRACKING.md after each completed task. Keep guest ordering and manual payments disabled until backend authorization, transaction logic and integration tests pass. Never commit credentials or invent restaurant menu prices/photos.

## Development workflow
- Create git repository and initial commit.
- Work one milestone at a time on feature branches.
- Add a test for each behavior; run `npm test && npm run typecheck && npm run build` before merging.
- Update CHANGELOG.md and TRACKING.md with commit, tests and blockers.
- Ask restaurant representative to approve menu/photos and financial rules before launch.

## First task
M0: install dependencies, verify preview, verify builds and Firebase emulator configuration. Then implement M1 menu import from approved CSV.
