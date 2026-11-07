import { describe, expect, it } from "vitest";
import type { Condition } from "./conditions.js";
import { noticeDue, problemNotice, resolvedNotice } from "./notices.js";

const TEST_OPTIONS = { timeout: 1000 };
const MINUTE = 60_000;
const SINCE = Date.UTC(2026, 10, 4, 12);

// At once when alerts are lost or not sent; after half an hour for what often passes by itself.
const AT_ONCE: readonly Condition[] = ["slack-refusing", "outbox-full", "alerts-expired"];
const AFTER_HALF_AN_HOUR: readonly Condition[] = ["slack-unreachable", "monitor-failing"];
// Never for what is set up with the app.
const NEVER: readonly Condition[] = ["token-missing", "channel-missing"];

describe("a modmail notice of a condition", (): void => {
    it.each(AT_ONCE)("is due at once for %s", TEST_OPTIONS, (condition: Condition): void => {
        expect.hasAssertions();

        expect(noticeDue(condition, SINCE, SINCE)).toBe(true);
    });

    it.each(AFTER_HALF_AN_HOUR)(
        "is due for %s once it has lasted half an hour, not before",
        TEST_OPTIONS,
        (condition: Condition): void => {
            expect.hasAssertions();

            expect(noticeDue(condition, SINCE, SINCE + 30 * MINUTE - 1)).toBe(false);
            expect(noticeDue(condition, SINCE, SINCE + 30 * MINUTE)).toBe(true);
        },
    );

    it.each(NEVER)("is never due for %s, which is set up with the app", TEST_OPTIONS, (condition: Condition): void => {
        expect.hasAssertions();

        expect(noticeDue(condition, SINCE, SINCE + 7 * 24 * 60 * MINUTE)).toBe(false);
    });

    it("names the problem, what to do, and when it started, to the minute in UTC", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const notice = problemNotice({ condition: "monitor-failing", since: SINCE + 59_999, detail: "reddit 503" });

        expect(notice.subject).toBe("Mod Action Notifications: The modqueue monitor is failing");
        expect(notice.body.split("\n\n")).toStrictEqual([
            "The modqueue monitor is failing (reddit 503), so no modqueue alerts are sent until it recovers.",
            "This started at 2026-11-04 12:00 UTC. **Show Bot Status**, in the subreddit's mod tools, shows how the bot is doing now.",
            "_The bot sends this at most once a day for each problem, and says when it is over._",
        ]);
    });

    it("of an end names the problem that ended", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(resolvedNotice("outbox-full")).toStrictEqual({
            subject: "Mod Action Notifications: resolved: A Slack queue is full",
            body: "The Slack queues have emptied: no more alerts are dropped for want of room.",
        });
    });
});
