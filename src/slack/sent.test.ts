import { describe, expect, it } from "vitest";
import { NOW } from "../../tests/fixtures/app.js";
import { outboxFakes } from "../../tests/fixtures/outbox.js";
import { rememberSent, takeSent } from "./sent.js";

const TEST_OPTIONS = { timeout: 5000 };
const REMEMBERED_KEY = "slack_outbox_sent";
const DAY = 86_400_000;
const POSTED = { channel: "C0123MODS", ts: "1793793600.000001" };
const QUOTING = { contentIds: ["t1_a"], withoutQuotes: { text: "removed t1_a" } };

describe("the alerts remembered in Slack", (): void => {
    it("are taken once, then forgotten", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await rememberSent(redis, POSTED, QUOTING);

        await expect(takeSent(redis, "t1_a")).resolves.toStrictEqual([
            { posted: POSTED, withoutQuotes: { text: "removed t1_a" } },
        ]);
        await expect(takeSent(redis, "t1_a")).resolves.toStrictEqual([]);
        expect(redis.keys()).toStrictEqual([]);
    });

    it("are each kept under every post and comment they quote", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await rememberSent(redis, POSTED, { ...QUOTING, contentIds: ["t1_a", "t3_b"] });

        await expect(takeSent(redis, "t3_b")).resolves.toHaveLength(1);
        await expect(takeSent(redis, "t1_a")).resolves.toHaveLength(1);
    });

    it("forget a post or comment last quoted over 90 days ago", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await redis.zAdd(REMEMBERED_KEY, { member: "t1_old", score: NOW.getTime() - 90 * DAY - 1 });

        await rememberSent(redis, POSTED, QUOTING);

        await expect(redis.zRange(REMEMBERED_KEY, 0, -1, { by: "rank" })).resolves.toStrictEqual([
            { member: "t1_a", score: NOW.getTime() },
        ]);
    });

    // At under a kilobyte each, 50,000 keep an installation well inside the 100 MB of Redis an unpublished app has.
    it("forget the oldest past 50,000 posts and comments, with their alerts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await redis.zAdd(
            REMEMBERED_KEY,
            ...Array.from(
                { length: 50_000 },
                (_unused: unknown, index: number): Readonly<{ member: string; score: number }> => ({
                    member: `t1_${String(index)}`,
                    score: NOW.getTime() - DAY + index,
                }),
            ),
        );
        await redis.hSet("slack_outbox_sent:t1_0", { [`${POSTED.channel} 1.000001`]: JSON.stringify({ text: "x" }) });

        await rememberSent(redis, POSTED, QUOTING);

        await expect(redis.zCard(REMEMBERED_KEY)).resolves.toBe(50_000);
        await expect(redis.zScore(REMEMBERED_KEY, "t1_0")).resolves.toBeUndefined();
        await expect(takeSent(redis, "t1_0")).resolves.toStrictEqual([]);
        await expect(takeSent(redis, "t1_a")).resolves.toHaveLength(1);
    });

    it("leave out a record this app cannot read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await redis.hSet("slack_outbox_sent:t1_a", {
            "no-timestamp": JSON.stringify({ text: "no timestamp" }),
            "C0123MODS 1.000001": "not JSON",
            "C0123MODS 1.000002": JSON.stringify({ attachments: [] }),
            "C0123MODS 1.000003": JSON.stringify({ text: "readable" }),
        });

        await expect(takeSent(redis, "t1_a")).resolves.toStrictEqual([
            { posted: { channel: "C0123MODS", ts: "1.000003" }, withoutQuotes: { text: "readable" } },
        ]);
    });
});
