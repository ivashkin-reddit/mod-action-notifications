import { describe, expect, it, vi } from "vitest";
import { drive, NOW } from "../../tests/fixtures/app.js";
import type { FakeRedis, ZMember } from "../../tests/fixtures/fakeRedis.js";
import { alertQuoting, drains, outboxFakes, queued, queuedQuoting, texts } from "../../tests/fixtures/outbox.js";
import type { OutboxFakes } from "../../tests/fixtures/outbox.js";
import { createSlackOutbox, forgetContent } from "./outbox.js";
import type { SlackOutbox } from "./outbox.js";

const TEST_OPTIONS = { timeout: 5000 };
const QUEUE_KEY = "slack_outbox";
const DELETED_KEY = "slack_outbox_deleted";
const DAY = 86_400_000;
/** Slack failing every attempt one drain makes at a message. */
const ONE_DRAIN_OF_FAILURES = [503, 503, 503, 503] as const;

/** An outbox on fake Redis, scheduler and Slack, with the clock frozen at NOW. */
function fakeOutbox(): OutboxFakes & Readonly<{ outbox: SlackOutbox }> {
    const fakes = outboxFakes();
    return { ...fakes, outbox: createSlackOutbox(fakes.dependencies) };
}

async function sendQuoting(outbox: SlackOutbox, contentId: string): Promise<void> {
    await drive(outbox.send(...alertQuoting(contentId)));
}

/** Everything the queue stores, as text. */
function stored(redis: Readonly<Pick<FakeRedis, "members">>): string {
    return redis.members(QUEUE_KEY).join("\n");
}

describe("content deleted on Reddit", (): void => {
    it("leaves the queue at once, though Slack is down", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, outbox, redis, slack } = fakeOutbox();
        slack.respond(...ONE_DRAIN_OF_FAILURES);
        await sendQuoting(outbox, "t1_a");

        await forgetContent(dependencies, "t1_a");

        expect(stored(redis)).toContain("removed t1_a");
        expect(stored(redis)).not.toContain("said");
    });

    it("leaves the queue with no bot token to send with", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, redis } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queuedQuoting("t1_a"));

        await forgetContent(
            { redis: dependencies.redis, scheduler: dependencies.scheduler, health: dependencies.health },
            "t1_a",
        );

        expect(stored(redis)).not.toContain("said");
    });

    it("is not quoted when its alert is delivered", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, outbox, slack } = fakeOutbox();
        slack.respond(...ONE_DRAIN_OF_FAILURES);
        await sendQuoting(outbox, "t1_a");
        await forgetContent(dependencies, "t1_a");

        await drive(outbox.deliverQueued());

        expect(texts(slack.messages).slice(ONE_DRAIN_OF_FAILURES.length)).toStrictEqual(["removed t1_a"]);
    });

    it("is never stored when deleted before its alert is sent", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, outbox, redis, slack } = fakeOutbox();
        await forgetContent(dependencies, "t1_a");
        slack.respond(...ONE_DRAIN_OF_FAILURES);

        await sendQuoting(outbox, "t1_a");

        expect(JSON.stringify(redis.zAdd.mock.calls)).not.toContain("said");
        expect(new Set(texts(slack.messages))).toStrictEqual(new Set(["removed t1_a"]));
    });

    it(
        "leaves its alert in its place in the queue, and other content's quotes as they were",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { dependencies, outbox, slack } = fakeOutbox();
            slack.respond(...ONE_DRAIN_OF_FAILURES, ...ONE_DRAIN_OF_FAILURES);
            await sendQuoting(outbox, "t1_a");
            await sendQuoting(outbox, "t1_b");
            await forgetContent(dependencies, "t1_a");

            await drive(outbox.deliverQueued());

            expect(texts(slack.messages).slice(-2)).toStrictEqual(["removed t1_a", "removed t1_b\n> what t1_b said"]);
        },
    );

    // An alert can be queued while the deletion holds the queue, and leave itself to a drain, as to one under way.
    it("is followed by a drain of what is queued", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, redis, scheduler } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queuedQuoting("t1_a"));

        await forgetContent(dependencies, "t1_a");

        expect(drains(scheduler.jobs)).toStrictEqual([1000]);
    });

    // The drain holding the queue was part way through when the content was deleted, so the deletion could not take
    // the quote out itself.
    it("leaves the queue before a drain under way lets go of it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, outbox, redis, slack } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("first", 2), queuedQuoting("t1_a", 1));
        slack.respond(...ONE_DRAIN_OF_FAILURES);
        const draining = outbox.deliverQueued();
        await vi.advanceTimersByTimeAsync(500);

        await forgetContent(dependencies, "t1_a");
        const duringTheDrain = stored(redis);
        await drive(draining);

        expect(duringTheDrain).toContain("said");
        expect(stored(redis)).not.toContain("said");
        expect(texts(slack.messages)).toStrictEqual(["first", "first", "first", "first"]);
    });

    // A day's deletions on a busy subreddit run to thousands, every post and comment deleted: a drain looks up only what
    // the alerts left in its queue quote.
    it(
        "is looked up by what queued alerts quote, however many deletions there were",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { dependencies, outbox, redis, slack } = fakeOutbox();
            await redis.zAdd(
                DELETED_KEY,
                ...Array.from(
                    { length: 5000 },
                    (_unused: unknown, index: number): { member: string; score: number } => ({
                        member: `t1_old${String(index)}`,
                        score: NOW.getTime() - index,
                    }),
                ),
            );
            await redis.zAdd(QUEUE_KEY, queued("first", 2), queuedQuoting("t1_a", 1));
            slack.respond(...ONE_DRAIN_OF_FAILURES);
            const draining = outbox.deliverQueued();
            await vi.advanceTimersByTimeAsync(500);

            await forgetContent(dependencies, "t1_a");
            await drive(draining);

            expect(stored(redis)).not.toContain("said");
            expect(
                redis.zRange.mock.calls.filter(([key]: readonly unknown[]): boolean => key === DELETED_KEY),
            ).toStrictEqual([]);
        },
    );

    // In a busy thread most queued alerts quote its post: the post is looked up once, not once for each of them.
    it("is looked up once, however many queued alerts quote it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, outbox, redis, slack } = fakeOutbox();
        await redis.zAdd(
            QUEUE_KEY,
            queued("first", 20),
            ...Array.from({ length: 10 }, (_unused: unknown, index: number): ZMember => {
                const queuedAt = NOW.getTime() - 10 + index;
                const comment = `t1_c${String(index)}`;
                return {
                    member: JSON.stringify({
                        id: comment,
                        queuedAt,
                        message: { text: `removed ${comment}\n> what the post said` },
                        contentIds: [comment, "t3_p"],
                        withoutQuotes: { text: `removed ${comment}` },
                    }),
                    score: queuedAt,
                };
            }),
        );
        slack.respond(...ONE_DRAIN_OF_FAILURES);
        const draining = outbox.deliverQueued();
        await vi.advanceTimersByTimeAsync(500);
        await forgetContent(dependencies, "t3_p");
        redis.zScore.mockClear();

        await drive(draining);

        expect(stored(redis)).not.toContain("said");
        expect(
            redis.zScore.mock.calls.filter(([, member]: readonly unknown[]): boolean => member === "t3_p"),
        ).toHaveLength(1);
    });

    it("is not quoted by an alert a drain under way reaches after", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, outbox, redis, slack } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("first", 2), queuedQuoting("t1_a", 1));
        slack.respond(503);
        const draining = outbox.deliverQueued();
        await vi.advanceTimersByTimeAsync(500);

        await forgetContent(dependencies, "t1_a");
        await drive(draining);

        expect(texts(slack.messages)).toStrictEqual(["first", "first", "removed t1_a"]);
    });

    it(
        "is remembered by its ID alone, leaving alerts that quote other content alone",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { dependencies, redis, scheduler } = fakeOutbox();
            await redis.zAdd(QUEUE_KEY, queuedQuoting("t1_b"));

            await forgetContent(dependencies, "t1_a");

            await expect(redis.zRange(DELETED_KEY, 0, -1, { by: "rank" })).resolves.toStrictEqual([
                { member: "t1_a", score: NOW.getTime() },
            ]);
            expect(stored(redis)).toContain("what t1_b said");
            expect(scheduler.jobs).toStrictEqual([]);
        },
    );

    // An alert waits at most a day, so a deletion is kept for as long, and a second more for one queued as it was
    // noted.
    it("is kept a second longer than an alert can wait", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, redis } = fakeOutbox();
        await forgetContent(dependencies, "t1_a");

        vi.setSystemTime(NOW.getTime() + DAY + 999);
        await forgetContent(dependencies, "t1_b");
        const justBefore = redis.members(DELETED_KEY);
        vi.setSystemTime(NOW.getTime() + DAY + 1000);
        await forgetContent(dependencies, "t1_c");

        expect(justBefore).toStrictEqual(["t1_a", "t1_b"]);
        expect(redis.members(DELETED_KEY)).toStrictEqual(["t1_b", "t1_c"]);
        expect(redis.ttlSeconds(DELETED_KEY)).toBe(DAY / 1000 + 1);
    });

    it("is not looked up while no queued alert quotes Reddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, outbox, redis, slack } = fakeOutbox();
        await forgetContent(dependencies, "t1_a");
        slack.respond(...ONE_DRAIN_OF_FAILURES);

        await drive(outbox.send({ text: "plain" }));

        expect(redis.members(QUEUE_KEY)).toHaveLength(1);
        expect(
            redis.zRange.mock.calls.filter(([key]: readonly unknown[]): boolean => key === DELETED_KEY),
        ).toStrictEqual([]);
    });

    // The queue's cap can drop the alert between the deletion reading the queue and rewriting it.
    it("does not bring back an alert that leaves the queue meanwhile", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, redis, scheduler } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queuedQuoting("t1_a"));
        const removeMembers = redis.zRem.getMockImplementation();
        redis.zRem.mockImplementationOnce(async (key: string, members: readonly string[]): Promise<number> => {
            await removeMembers?.(key, members);
            return 0;
        });

        await forgetContent(dependencies, "t1_a");

        expect(redis.members(QUEUE_KEY)).toStrictEqual([]);
        expect(scheduler.jobs).toStrictEqual([]);
    });

    it("cannot be noted when Redis fails, and says so", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, redis } = fakeOutbox();
        redis.zAdd.mockRejectedValueOnce(new Error("redis down"));

        await expect(forgetContent(dependencies, "t1_a")).rejects.toThrow("redis down");
    });
});
