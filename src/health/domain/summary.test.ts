import { describe, expect, it } from "vitest";
import { dailySummary, yesterdayOf } from "./summary.js";

const TEST_OPTIONS = { timeout: 1000 };

describe("the daily summary", (): void => {
    it("covers the UTC day before the one it is sent on", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(yesterdayOf(Date.UTC(2026, 10, 5, 8))).toBe("2026-11-04");
        expect(yesterdayOf(Date.UTC(2026, 10, 5, 0))).toBe("2026-11-04");
        expect(yesterdayOf(Date.UTC(2026, 10, 4, 23, 59))).toBe("2026-11-03");
    });

    it("counts the monitor's runs as its successes and failures together", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const summary = dailySummary(
            "2026-11-04",
            {
                "mod-action": 3,
                "alert-delivered": 2,
                "alert-dropped": 1,
                "alert-redacted": 4,
                "monitor-success": 1,
                "monitor-failure": 1,
            },
            [],
        );

        expect(summary.lines).toStrictEqual([
            { label: "Mod actions", value: "3" },
            { label: "Alerts", value: "2 delivered, 1 dropped, 4 redacted" },
            { label: "Modqueue monitor", value: "2 runs, 1 failed" },
            { label: "Problems now", value: "None" },
        ]);
    });

    it("names one run as one", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(dailySummary("2026-11-04", { "monitor-success": 1 }, []).lines[2]?.value).toBe("1 run, 0 failed");
    });

    it("names each problem in force, by its title", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const summary = dailySummary("2026-11-04", {}, [
            { condition: "slack-unreachable", since: 0, detail: "HTTP 503: error" },
            { condition: "monitor-failing", since: 0, detail: "reddit 503" },
        ]);

        expect(summary.lines[3]?.value).toBe("Slack is not taking alerts; The modqueue monitor is failing");
    });
});
