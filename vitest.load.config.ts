import { defineConfig } from "vitest/config";

/**
 * The load harness (tests/load/): the app's handlers against a real Redis, driven by generated event streams. Run by
 * hand with `npm run load`, after `npm run load:redis`: it empties the Redis it is given. Not part of CI.
 */
/** A scenario may take this long: the soak runs half an hour, and settles after. */
const SCENARIO_TIMEOUT_MS = 3_600_000;

export default defineConfig({
    test: {
        include: ["tests/load/**/*.load.test.ts"],
        env: { TZ: "UTC" },
        mockReset: true,
        restoreMocks: true,
        unstubGlobals: true,
        fileParallelism: false,
        testTimeout: SCENARIO_TIMEOUT_MS,
    },
});
