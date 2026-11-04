import { afterEach, beforeEach, vi } from 'vitest';

beforeEach(() => {
  // The app logs the failures it recovers from. Silence them; tests that care assert on these spies.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
});
