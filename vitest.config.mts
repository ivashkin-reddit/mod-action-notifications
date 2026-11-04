import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/support/setup.ts'],
    // Devvit runs in UTC; timestamps in Slack messages must not depend on the machine's time zone.
    env: { TZ: 'UTC' },
    // Every test starts with fresh mocks, spies and globals, so tests need no cleanup hooks.
    mockReset: true,
    restoreMocks: true,
    unstubGlobals: true,
    // Random order exposes a test that depends on what another test left behind.
    sequence: { shuffle: true },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text', 'html'],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
