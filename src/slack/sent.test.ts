import { describe, expect, it, vi } from "vitest";
import { NOW } from "../../tests/fixtures/app.js";
import type { ZMember } from "../../tests/fixtures/fakeRedis.js";
import { outboxFakes } from "../../tests/fixtures/outbox.js";
import { rememberSent, takeSent } from "./sent.js";
import type { SentAlert, SentRedis } from "./sent.js";

const TEST_OPTIONS = { timeout: 5000 };
// Stored data: renaming these keys would lose what installations hold.
const BY_CONTENT_KEY = "slack_outbox_sent_by_content";
const BY_TIME_KEY = "slack_outbox_sent_by_time";
const LEGACY_KEY = "slack_outbox_sent:t1_a";
const DAY = 86_400_000;
const POSTED = { channel: "C0123MODS", ts: "1793793600.000001" };
const ALERT_KEY = "slack_outbox_sent_alert:C0123MODS:1793793600.000001";
const QUOTING = { contentIds: ["t1_a"], withoutQuotes: { text: "removed t1_a" } };
/** How many days the alert channels keep messages, unless a test says otherwise. */
const RETENTION_DAYS = 90;

/** Takes the alerts remembered for the content, as a deletion does, and returns them. */
async function take(redis: SentRedis, contentId: string): Promise<readonly SentAlert[]> {
    const taken: SentAlert[] = [];
    await takeSent(redis, contentId, async (alerts: readonly SentAlert[]): Promise<void> => {
        taken.push(...alerts);
        await Promise.resolve();
    });
    return taken;
}

/** Entries for `count` alerts quoting t1_a, scored as the index by content scores them. */
function entries(count: number, score: (index: number) => number): ZMember[] {
    return Array.from({ length: count }, (_unused: unknown, index: number): ZMember => ({
        member: `t1_a C0123MODS 1.${String(index)}`,
        score: score(index),
    }));
}

describe("the alerts remembered in Slack", (): void => {
    it("are taken once, then forgotten", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await rememberSent({ redis, retentionDays: RETENTION_DAYS }, POSTED, QUOTING);

        await expect(take(redis, "t1_a")).resolves.toStrictEqual([
            { posted: POSTED, withoutQuotes: { text: "removed t1_a" } },
        ]);
        await expect(take(redis, "t1_a")).resolves.toStrictEqual([]);
        // The alert itself stays as long as Slack keeps it, for another post or comment it quotes.
        expect(redis.keys()).toStrictEqual([ALERT_KEY]);
    });

    it("are each kept under every post and comment they quote", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await rememberSent({ redis, retentionDays: RETENTION_DAYS }, POSTED, {
            ...QUOTING,
            contentIds: ["t1_a", "t3_b"],
        });

        await expect(take(redis, "t3_b")).resolves.toHaveLength(1);
        await expect(take(redis, "t1_a")).resolves.toHaveLength(1);
    });

    // A post quoted again keeps none of its older alerts past the channels' retention: Slack has deleted them.
    it(
        "forget each alert the channels' retention after it was sent, though its post is quoted again",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { redis } = outboxFakes();
            await rememberSent(
                { redis, retentionDays: RETENTION_DAYS },
                { channel: "C0123MODS", ts: "1.000001" },
                QUOTING,
            );
            vi.advanceTimersByTime(60 * DAY);
            await rememberSent({ redis, retentionDays: RETENTION_DAYS }, POSTED, QUOTING);
            vi.advanceTimersByTime(31 * DAY);

            await expect(take(redis, "t1_a")).resolves.toStrictEqual([
                { posted: POSTED, withoutQuotes: { text: "removed t1_a" } },
            ]);
        },
    );

    it("forget the entries of an alert sent over 90 days ago", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await rememberSent({ redis, retentionDays: RETENTION_DAYS }, { channel: "C0123MODS", ts: "1.000001" }, QUOTING);
        vi.advanceTimersByTime(90 * DAY + 1);

        await rememberSent({ redis, retentionDays: RETENTION_DAYS }, POSTED, { ...QUOTING, contentIds: ["t1_b"] });

        expect(redis.members(BY_TIME_KEY)).toStrictEqual([`t1_b ${POSTED.channel} ${POSTED.ts}`]);
        expect(redis.members(BY_CONTENT_KEY)).toStrictEqual([`t1_b ${POSTED.channel} ${POSTED.ts}`]);
    });

    // A moderator can shorten the retention: what was remembered for longer goes, alerts and all.
    it(
        "forget, with their alerts, those sent before the channels' retention",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { redis } = outboxFakes();
            await rememberSent({ redis, retentionDays: RETENTION_DAYS }, POSTED, QUOTING);
            vi.advanceTimersByTime(30 * DAY + 1);

            await rememberSent(
                { redis, retentionDays: 30 },
                { channel: "C0123MODS", ts: "2.000001" },
                {
                    ...QUOTING,
                    contentIds: ["t1_b"],
                },
            );

            await expect(take(redis, "t1_a")).resolves.toStrictEqual([]);
            expect(redis.keys()).not.toContain(ALERT_KEY);
        },
    );

    // Shortening the retention can leave many past it: each alert sent forgets a bounded batch of them.
    it("forget at most 1,000 past the channels' retention at a time", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await redis.zAdd(
            BY_TIME_KEY,
            ...entries(1001, (index: number): number => NOW.getTime() - 30 * DAY - 1 - index),
        );

        await rememberSent({ redis, retentionDays: 30 }, POSTED, QUOTING);

        await expect(redis.zCard(BY_TIME_KEY)).resolves.toBe(2);

        await rememberSent({ redis, retentionDays: 30 }, POSTED, QUOTING);

        await expect(redis.zCard(BY_TIME_KEY)).resolves.toBe(1);
    });

    // At about a kilobyte an alert, 100,000 keep an installation inside the 5 GB of Redis Devvit documents.
    it("forget the oldest past 100,000 entries, with their alerts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        const kept = entries(100_000, (index: number): number => NOW.getTime() - DAY + index);
        // In runs, as one request to Redis carries at most 5 MB.
        await Promise.all(
            [0, 1, 2, 3, 4].map(async (run: number): Promise<void> => {
                await redis.zAdd(BY_TIME_KEY, ...kept.slice(run * 20_000, (run + 1) * 20_000));
            }),
        );
        await redis.zAdd(BY_CONTENT_KEY, { member: "t1_a C0123MODS 1.0", score: 0 });
        await redis.set("slack_outbox_sent_alert:C0123MODS:1.0", JSON.stringify({ text: "oldest" }));

        await rememberSent({ redis, retentionDays: RETENTION_DAYS }, POSTED, QUOTING);

        await expect(redis.zCard(BY_TIME_KEY)).resolves.toBe(100_000);
        await expect(redis.zScore(BY_TIME_KEY, "t1_a C0123MODS 1.0")).resolves.toBeUndefined();
        expect(redis.keys()).not.toContain("slack_outbox_sent_alert:C0123MODS:1.0");
        await expect(take(redis, "t1_a")).resolves.toStrictEqual([
            { posted: POSTED, withoutQuotes: { text: "removed t1_a" } },
        ]);
    });

    // Devvit answers at most 1,000 members from one range, and each read must fit in one request.
    it("are all taken, however many quote one post", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await redis.zAdd(BY_CONTENT_KEY, ...entries(1001, (): number => 0));
        await Promise.all(
            Array.from({ length: 1001 }, async (_unused: unknown, index: number): Promise<void> => {
                await redis.set(`slack_outbox_sent_alert:C0123MODS:1.${String(index)}`, JSON.stringify({ text: "x" }));
            }),
        );

        await expect(take(redis, "t1_a")).resolves.toHaveLength(1001);
        expect(redis.keys()).not.toContain(BY_CONTENT_KEY);
    });

    it("leave out a record this app cannot read, and forget it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await redis.zAdd(
            BY_CONTENT_KEY,
            ...[
                "t1_a no-timestamp",
                "t1_a C0123MODS 1.000001",
                "t1_a C0123MODS 1.000002",
                "t1_a C0123MODS 1.000003",
            ].map((member: string): ZMember => ({ member, score: 0 })),
        );
        await redis.set("slack_outbox_sent_alert:C0123MODS:1.000001", "not JSON");
        await redis.set("slack_outbox_sent_alert:C0123MODS:1.000002", JSON.stringify({ attachments: [] }));
        await redis.set("slack_outbox_sent_alert:C0123MODS:1.000003", JSON.stringify({ text: "readable" }));

        await expect(take(redis, "t1_a")).resolves.toStrictEqual([
            { posted: { channel: "C0123MODS", ts: "1.000003" }, withoutQuotes: { text: "readable" } },
        ]);
        expect(redis.keys()).not.toContain(BY_CONTENT_KEY);
    });

    it("are not remembered for an alert that quotes nothing", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();

        await rememberSent({ redis, retentionDays: RETENTION_DAYS }, POSTED, { ...QUOTING, contentIds: [] });

        expect(redis.keys()).toStrictEqual([]);
    });
});

// An earlier version kept a hash for each post and comment: read until the last has expired, 90 days at most.
describe("the alerts an earlier version remembered in Slack", (): void => {
    it("are taken, a page at a time, then forgotten", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await redis.hSet(
            LEGACY_KEY,
            Object.fromEntries(
                Array.from({ length: 150 }, (_unused: unknown, index: number): [string, string] => [
                    `C0123MODS 1.${String(index).padStart(3, "0")}`,
                    JSON.stringify({ text: "removed t1_a" }),
                ]),
            ),
        );

        await expect(take(redis, "t1_a")).resolves.toHaveLength(150);
        expect(redis.keys()).toStrictEqual([]);
    });

    it("leave out a record this app cannot read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = outboxFakes();
        await redis.hSet(LEGACY_KEY, {
            "no-timestamp": JSON.stringify({ text: "no timestamp" }),
            "C0123MODS 1.000001": "not JSON",
            "C0123MODS 1.000002": JSON.stringify({ attachments: [] }),
            "C0123MODS 1.000003": JSON.stringify({ text: "readable" }),
        });

        await expect(take(redis, "t1_a")).resolves.toStrictEqual([
            { posted: { channel: "C0123MODS", ts: "1.000003" }, withoutQuotes: { text: "readable" } },
        ]);
    });
});
