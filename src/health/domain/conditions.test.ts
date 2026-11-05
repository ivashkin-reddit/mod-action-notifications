import { describe, expect, it } from "vitest";
import { conditionContinuing, conditionResolved, conditionStarted } from "./conditions.js";
import type { Condition, LogLevel } from "./conditions.js";

const TEST_OPTIONS = { timeout: 1000 };
const STARTED_AT = Date.UTC(2026, 10, 4, 12);

// An error when alerts are lost or a feature has stopped; a warning when alerts wait, or none is set up to go.
const LEVELS: readonly (readonly [Condition, LogLevel])[] = [
    ["token-missing", "warn"],
    ["channel-missing", "warn"],
    ["slack-refusing", "error"],
    ["slack-unreachable", "warn"],
    ["outbox-full", "error"],
    ["alerts-expired", "error"],
    ["monitor-failing", "error"],
];

describe("the lines for a condition", (): void => {
    it.each(LEVELS)("start %s as a line at level %s", TEST_OPTIONS, (condition: Condition, level: LogLevel): void => {
        expect.hasAssertions();

        expect(conditionStarted(condition, "detail").level).toBe(level);
        expect(conditionStarted(condition, "detail").text).toMatch(/^\[health\] \S/u);
    });

    it.each(LEVELS)("repeat %s at its own level, %s", TEST_OPTIONS, (condition: Condition, level: LogLevel): void => {
        expect.hasAssertions();

        expect(conditionContinuing(condition, "detail", STARTED_AT).level).toBe(level);
    });

    it.each(LEVELS)("end %s as information", TEST_OPTIONS, (condition: Condition): void => {
        expect.hasAssertions();

        expect(conditionResolved(condition).level).toBe("info");
        expect(conditionResolved(condition).text).toMatch(/^\[health\] \S/u);
    });

    it("say what the app saw of the problem", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(conditionStarted("monitor-failing", "reddit 503").text).toBe(
            "[health] The modqueue monitor is failing (reddit 503), so no modqueue alerts are sent until it recovers.",
        );
    });

    it("say, once repeated, since when the problem has lasted", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(conditionContinuing("slack-unreachable", "HTTP 503: error", STARTED_AT).text).toBe(
            "[health] Since 2026-11-04T12:00:00.000Z: Slack is not taking alerts (HTTP 503: error), so they wait in the queue. Alerts are dropped after a day, or beyond 500 waiting.",
        );
    });
});
