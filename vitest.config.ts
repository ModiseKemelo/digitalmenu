import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    // The emulator suites share one Firestore instance, so files must not run
    // against each other in parallel.
    fileParallelism: false,
    // Generous timeouts and a single retry: these suites talk to the Firebase
    // emulators over the loopback network, which occasionally stalls for tens
    // of seconds under WSL. A genuinely broken test still fails both attempts.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    retry: 1,
  },
  resolve: {
    alias: {'@': new URL('./src', import.meta.url).pathname},
  },
});
