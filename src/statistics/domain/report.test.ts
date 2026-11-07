import { describe, expect, it } from "vitest";
import { dayRange, teamReport } from "./report.js";
import type { DayCounts } from "./report.js";

const TEST_OPTIONS = { timeout: 1000 };
const FULL_DAY = 24;

function counts(fields: Readonly<Partial<DayCounts>> = {}): DayCounts {
    return { actions: {}, hours: {}, bans: {}, moderators: [], threads: [], outcomes: {}, ...fields };
}

describe("the team's report", (): void => {
    it("totals actions by who took them, with the most common types", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const report = teamReport([
            {
                counts: counts({
                    actions: { "moderators:removelink": 3, "automoderator:removelink": 1, "reddit:removecomment": 2 },
                }),
                hours: FULL_DAY,
            },
        ]);

        expect([report.actions, report.topTypes]).toStrictEqual([
            { total: 6, moderators: 3, automoderator: 1, reddit: 2 },
            [
                { type: "removelink", count: 4 },
                { type: "removecomment", count: 2 },
            ],
        ]);
    });

    it("counts the hours with no moderator action, and finds the busiest", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const report = teamReport([
            { counts: counts({ hours: { "9": 2, "21": 5 } }), hours: FULL_DAY },
            { counts: counts({ hours: { "3": 1, "21": 1 } }), hours: 12 },
        ]);

        expect([report.quietHours, report.hours, report.busiestHour]).toStrictEqual([33, 36, 21]);
    });

    it("averages the length of temporary bans", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const report = teamReport([
            { counts: counts({ bans: { bans: 2, temporary: 1, banDays: 7, permanent: 1 } }), hours: FULL_DAY },
            { counts: counts({ bans: { bans: 1, temporary: 1, banDays: 3, unbans: 2 } }), hours: FULL_DAY },
        ]);

        expect(report.bans).toStrictEqual({ bans: 3, temporary: 2, permanent: 1, averageDays: 5, unbans: 2 });
    });

    it("counts each moderator who acted once, across days", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const report = teamReport([
            { counts: counts({ moderators: ["0000000a", "0000000b"] }), hours: FULL_DAY },
            { counts: counts({ moderators: ["0000000b", "0000000c"] }), hours: FULL_DAY },
        ]);

        expect(report.activeModerators).toBe(3);
    });

    it("finds the most-moderated threads across days", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const report = teamReport([
            {
                counts: counts({
                    threads: [
                        { postId: "t3_a", removals: 3 },
                        { postId: "t3_b", removals: 1 },
                    ],
                }),
                hours: FULL_DAY,
            },
            { counts: counts({ threads: [{ postId: "t3_b", removals: 4 }] }), hours: FULL_DAY },
        ]);

        expect(report.topThreads).toStrictEqual([
            { postId: "t3_b", removals: 5 },
            { postId: "t3_a", removals: 3 },
        ]);
    });

    it("says nothing is known of a period with no counts", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const report = teamReport([{ counts: counts(), hours: FULL_DAY }]);

        expect([report.busiestHour, report.bans.averageDays, report.topTypes, report.topThreads]).toStrictEqual([
            undefined,
            undefined,
            [],
            [],
        ]);
    });
});

describe("a range of days", (): void => {
    it("ends the given number of days before today, oldest first", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const now = Date.parse("2026-11-09T08:00:00Z");

        expect([dayRange(now, 3, 0), dayRange(now, 2, 1)]).toStrictEqual([
            ["2026-11-07", "2026-11-08", "2026-11-09"],
            ["2026-11-07", "2026-11-08"],
        ]);
    });
});
