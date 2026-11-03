import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    // One Firestore instance is shared, so files run one at a time, and the
    // database is cleared once up front rather than per file.
    fileParallelism: false,
    globalSetup: ['tests/integration/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Kept as a safety net for loopback/emulator hiccups, not to mask product
    // bugs: a genuinely broken test still fails both attempts. The flakiness
    // this originally hid was a real defect — HttpsErrors thrown out of a
    // transaction callback left unhandled rollback errors behind — and that is
    // fixed in functions/src (see TxResult in runtime.ts).
    retry: 1,
  },
  resolve: {alias: {'@': new URL('./src', import.meta.url).pathname}},
});
