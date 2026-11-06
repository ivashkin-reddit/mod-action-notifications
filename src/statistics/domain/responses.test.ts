import { describe, expect, it } from "vitest";
import { responseReport } from "./responseReport.js";
import { bucketOf, MAX_WAITING, reversalOutcome, settlingOf, staleEntries } from "./responses.js";

const TEST_OPTIONS = { timeout: 1000 };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 10, 4, 12);

describe("a response's bucket", (): void => {
    it("is the first bound it is within, else longer", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([
            bucketOf(15 * MINUTE),
            bucketOf(15 * MINUTE + 1),
            bucketOf(HOUR),
            bucketOf(4 * HOUR),
            bucketOf(12 * HOUR),
            bucketOf(DAY),
            bucketOf(DAY + 1),
        ]).toStrictEqual(["15m", "1h", "1h", "4h", "12h", "24h", "longer"]);
    });
});

describe("a mod action settling an item", (): void => {
    it("is a removal, spam or not, or an approval", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(
            ["removelink", "spamcomment", "approvecomment", "lock"].map((type: string): string | undefined =>
                settlingOf(type),
            ),
        ).toStrictEqual(["removed", "removed", "approved", undefined]);
    });

    it("reverses Reddit's removal, or another moderator's, never the approver's own", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([
            reversalOutcome("reddit", "aaaa0001"),
            reversalOutcome("bbbb0002", "aaaa0001"),
            reversalOutcome("aaaa0001", "aaaa0001"),
        ]).toStrictEqual([{ "reversed:reddit": 1 }, { "reversed:moderator": 1 }, {}]);
    });
});

describe("what waits", (): void => {
    it("is forgotten after a week", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(
            staleEntries(
                [
                    ["old", NOW - 7 * DAY - 1],
                    ["week", NOW - 7 * DAY],
                    ["new", NOW],
                ],
                NOW,
            ),
        ).toStrictEqual(["old"]);
    });

    it("keeps the newest 9,000 once more than the most wait", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const entries = Array.from(
            { length: MAX_WAITING + 1 },
            (_unused: unknown, index: number): readonly [string, number] => [`item${String(index)}`, NOW - index],
        );

        const stale = staleEntries(entries, NOW);

        expect([stale.length, stale[0], stale[stale.length - 1]]).toStrictEqual([1001, "item9000", "item10000"]);
    });
});

describe("the team's response report", (): void => {
    it("gives how many responses there were, and the bucket of the middle one", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const report = responseReport({
            "queue:15m": 2,
            "queue:4h": 1,
            "queue:longer": 2,
            "modmail:24h": 1,
            "report:removed": 3,
            "automoderator:approved": 1,
            "reversed:moderator": 2,
        });

        expect(report).toStrictEqual({
            queue: { handled: 5, median: "4h" },
            reported: { removed: 3, approved: 0 },
            filtered: { removed: 0, approved: 1 },
            reversals: { reddit: 0, moderator: 2 },
            modmail: { replies: 1, median: "24h" },
        });
    });

    it("has no median without responses", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(responseReport({}).queue).toStrictEqual({ handled: 0, median: undefined });
    });
});
