import { afterEach, beforeEach, vi } from "vitest";

beforeEach((): void => {
    // The app logs the failures it recovers from. Silence them; tests that care assert on these spies.
    vi.spyOn(console, "error").mockImplementation((): void => undefined);
    vi.spyOn(console, "warn").mockImplementation((): void => undefined);
    vi.spyOn(console, "info").mockImplementation((): void => undefined);
    vi.spyOn(console, "log").mockImplementation((): void => undefined);
});

afterEach((): void => {
    vi.useRealTimers();
});
