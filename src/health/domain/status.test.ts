import { describe, expect, it } from "vitest";
import { countsText, durationText, statusLines } from "./status.js";
import type { StatusInput } from "./status.js";

const TEST_OPTIONS = { timeout: 1000 };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 4, 12);

/** A working app's status at NOW: `fields` replaces any part. */
function input(fields: Readonly<Partial<StatusInput>> = {}): StatusInput {
    return {
        now: NOW,
        version: "1.2.3",
        slack: "set-up",
        monitor: { enabled: true, job: "scheduled", cron: "*/15 * * * *" },
        problems: [],
        queue: { waiting: 0, oldestQueuedAt: undefined },
        lastSeen: {},
        today: {},
        ...fields,
    };
}

/** The value of the status line with this label. */
function line(status: StatusInput, label: string): string | undefined {
    return statusLines(status).find((statusLine): boolean => statusLine.label === label)?.value;
}

describe("a length of time", (): void => {
    it.each([
        [MINUTE - 1, "less than a minute"],
        [MINUTE, "1 minute"],
        [59 * MINUTE, "59 minutes"],
        [HOUR, "1 hour"],
        [DAY - 1, "23 hours"],
        [DAY, "1 day"],
        [3 * DAY, "3 days"],
    ])("of %i ms reads as %s", TEST_OPTIONS, (ms: number, text: string): void => {
        expect.hasAssertions();

        expect(durationText(ms)).toBe(text);
    });
});

describe("a day's counts", (): void => {
    it("read as none of each on a quiet day", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(countsText({})).toBe("0 mod actions; 0 alerts delivered, 0 dropped; 0 monitor runs, 0 failed");
    });

    it("count the monitor's runs as its successes and failures together", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(
            countsText({
                "mod-action": 1,
                "alert-delivered": 1,
                "alert-dropped": 2,
                "monitor-success": 3,
                "monitor-failure": 1,
            }),
        ).toBe("1 mod action; 1 alert delivered, 2 dropped; 4 monitor runs, 1 failed");
    });
});

describe("the status", (): void => {
    it.each([["none" as const], ["one-off" as const]])(
        "says a monitor turned off but still holding a %s job needs setting up",
        TEST_OPTIONS,
        (job: "none" | "one-off"): void => {
            expect.hasAssertions();

            expect(line(input({ monitor: { enabled: false, job } }), "Modqueue monitor")).toBe(
                job === "none"
                    ? "Off: all its thresholds are 0"
                    : "Off, but still scheduled. Use Setup Modqueue Monitoring.",
            );
        },
    );

    it(
        "gives the monitor's last run as whichever of its last success and failure came later",
        TEST_OPTIONS,
        (): void => {
            expect.hasAssertions();

            const failedLast = input({
                lastSeen: { "monitor-success": NOW - 2 * HOUR, "monitor-failure": NOW - HOUR },
            });
            const succeededLast = input({
                lastSeen: { "monitor-success": NOW - HOUR, "monitor-failure": NOW - 2 * HOUR },
            });

            expect(line(failedLast, "Last monitor run")).toBe("1 hour ago, failed");
            expect(line(succeededLast, "Last monitor run")).toBe("1 hour ago, succeeded");
        },
    );

    it("counts alerts waiting even when the oldest's age cannot be read", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(line(input({ queue: { waiting: 3, oldestQueuedAt: undefined } }), "Alerts waiting")).toBe("3");
    });

    it("says what it could not read from Redis", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const unread = input({ problems: undefined, queue: undefined, lastSeen: undefined, today: undefined });

        expect(
            statusLines(unread)
                .filter((statusLine): boolean => statusLine.value === "Unknown: Redis could not be read")
                .map((statusLine): string => statusLine.label),
        ).toStrictEqual([
            "Current problems",
            "Alerts waiting",
            "Last alert delivered",
            "Last monitor run",
            "Last events",
            "Today (UTC)",
        ]);
    });
});
