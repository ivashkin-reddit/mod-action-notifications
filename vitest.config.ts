import { defineConfig } from "vitest/config";

/** `npm run coverage` fails when any coverage measure of src/ falls below this percentage. */
const MINIMUM_COVERAGE_PERCENT = 90;

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts"],
        setupFiles: ["tests/support/setup.ts"],
        // Devvit runs in UTC; timestamps in Slack messages must not depend on the machine's time zone.
        env: { TZ: "UTC" },
        // Every test starts with fresh mocks, spies and globals, so tests need no cleanup hooks.
        mockReset: true,
        restoreMocks: true,
        unstubGlobals: true,
        // Random order exposes a test that depends on what another test left behind.
        sequence: { shuffle: true },
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            reporter: ["text", "html"],
            thresholds: {
                statements: MINIMUM_COVERAGE_PERCENT,
                branches: MINIMUM_COVERAGE_PERCENT,
                functions: MINIMUM_COVERAGE_PERCENT,
                lines: MINIMUM_COVERAGE_PERCENT,
            },
        },
    },
});
