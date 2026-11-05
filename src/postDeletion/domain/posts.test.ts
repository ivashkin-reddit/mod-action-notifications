import { describe, expect, it } from "vitest";
import { deletionAlertsOn, deservesAlert } from "./posts.js";

const TEST_OPTIONS = { timeout: 1000 };

describe("deleted-post alerts", (): void => {
    it("are off at a threshold of 0 and on above it", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([deletionAlertsOn(0), deletionAlertsOn(1), deletionAlertsOn(100)]).toStrictEqual([false, true, true]);
    });
});

describe("a deleted post that deserves an alert", (): void => {
    it.each([
        [99, 100, false],
        [100, 100, true],
        [5000, 100, true],
        [5000, 0, false],
        [-3, 1, false],
    ])(
        "scored %i against a threshold of %i: %j",
        TEST_OPTIONS,
        (score: number, threshold: number, deserves: boolean): void => {
            expect.hasAssertions();

            expect(deservesAlert(score, threshold)).toBe(deserves);
        },
    );
});
