import { describe, expect, it, vi } from "vitest";
import { drive, NOW } from "../../tests/fixtures/app.js";
import { drains, outboxFakes, queued, sendTimes, texts } from "../../tests/fixtures/outbox.js";
import type { OutboxFakes } from "../../tests/fixtures/outbox.js";
import { createSlackOutbox } from "./outbox.js";
import type { SlackOutbox } from "./outbox.js";

const TEST_OPTIONS = { timeout: 5000 };
const QUEUE_KEY = "slack_outbox";
const LEASE_KEY = "slack_outbox_lease";
/** The lease: a drain's 10 s budget, a 1.1 s pause, Devvit's 30 s fetch timeout and a 5 s margin. */
const LEASE_MS = 46_100;
const DAY = 86_400_000;

/** An outbox on fake Redis, scheduler and Slack, with the clock frozen at NOW. */
function fakeOutbox(): OutboxFakes & Readonly<{ outbox: SlackOutbox }> {
    const fakes = outboxFakes();
    return { ...fakes, outbox: createSlackOutbox(fakes.dependencies) };
}

describe("sending through the outbox", (): void => {
    // What stays is when Slack was last sent a message, and the check that follows in case the drain had died.
    it(
        "delivers a message at once when nothing is queued, keeping only its pace and a check",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { outbox, redis, slack } = fakeOutbox();

            await drive(outbox.send({ text: "hello" }));

            expect(texts(slack.messages)).toStrictEqual(["hello"]);
            expect(redis.keys()).toStrictEqual(["slack_outbox_last_sent", "slack_outbox_recovery_scheduled"]);
            expect(redis.ttlSeconds("slack_outbox_last_sent")).toBe(60);
        },
    );

    it("sends straight to Slack, logged, when the queue cannot be written", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, slack } = fakeOutbox();
        const failure = new Error("redis down");
        redis.zAdd.mockRejectedValueOnce(failure);

        await drive(outbox.send({ text: "hello" }));

        expect(texts(slack.messages)).toStrictEqual(["hello"]);
        expect(console.warn).toHaveBeenCalledWith(
            "[outbox] Could not queue an alert, so sent it straight to Slack:",
            failure,
        );
    });

    it(
        "keeps at most 500 messages, dropping the oldest, and says the queue is full",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { health, outbox, redis, slack } = fakeOutbox();
            await redis.set(LEASE_KEY, "another drain", { expiration: new Date(NOW.getTime() + LEASE_MS) });
            for (let index = 0; index < 500; index += 1) {
                await redis.zAdd(QUEUE_KEY, queued(`old ${String(index)}`, DAY - index));
            }

            await drive(outbox.send({ text: "newest" }));

            expect(slack.requests).toStrictEqual([]);

            const [oldestLeft] = await redis.zRange(QUEUE_KEY, 0, 0, { by: "rank" });

            expect(oldestLeft?.member).toContain('"id":"old 1"');
            expect(health.raise).toHaveBeenCalledWith("outbox-full", "");
        },
    );
});

describe("a drain of the outbox", (): void => {
    it("delivers the queue oldest first, 1.1 seconds apart", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, slack } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("first", 3));
        await redis.zAdd(QUEUE_KEY, queued("second", 2));
        await redis.zAdd(QUEUE_KEY, queued("third", 1));

        await drive(outbox.deliverQueued());

        expect(texts(slack.messages)).toStrictEqual(["first", "second", "third"]);
        expect(sendTimes(slack.requests)).toStrictEqual([0, 1100, 2200]);
    });

    it("waits as long as Slack's Retry-After asks", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, slack } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("hello"));
        slack.respond({ retryAfterSeconds: 4 });

        await drive(outbox.deliverQueued());

        expect(sendTimes(slack.requests)).toStrictEqual([0, 4000]);
    });

    it("drops, logged, a message Slack refuses", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, slack } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("refused", 2));
        await redis.zAdd(QUEUE_KEY, queued("next", 1));
        slack.respond(404);

        await drive(outbox.deliverQueued());

        expect(texts(slack.messages)).toStrictEqual(["refused", "next"]);
        expect(redis.keys()).not.toContain(QUEUE_KEY);
    });

    it(
        "drops unsent a message queued over a day ago, saying so, and any it cannot read, logged",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { health, outbox, redis, slack } = fakeOutbox();
            await redis.zAdd(QUEUE_KEY, queued("stale", DAY + 1));
            await redis.zAdd(QUEUE_KEY, { member: "not json", score: NOW.getTime() });
            await redis.zAdd(QUEUE_KEY, {
                member: JSON.stringify({ id: "no text", queuedAt: NOW.getTime(), message: { blocks: [] } }),
                score: NOW.getTime(),
            });
            await redis.zAdd(QUEUE_KEY, queued("fresh"));

            await drive(outbox.deliverQueued());

            expect(texts(slack.messages)).toStrictEqual(["fresh"]);
            expect(health.raise.mock.calls).toStrictEqual([["alerts-expired", ""]]);
            expect(vi.mocked(console.warn).mock.calls).toStrictEqual([
                ["[outbox] Dropped a queued alert it could not read"],
                ["[outbox] Dropped a queued alert it could not read"],
            ]);
        },
    );

    it("leaves what it cannot send in 10 seconds to a drain a second later", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, scheduler, slack } = fakeOutbox();
        for (let index = 0; index < 12; index += 1) {
            await redis.zAdd(QUEUE_KEY, queued(`m${String(index)}`, 12 - index));
        }

        await drive(outbox.deliverQueued());

        // The last delivery starts before the budget runs out, at 11 s; the next drain is due a second after.
        expect(sendTimes(slack.requests)).toHaveLength(11);
        expect(drains(scheduler.jobs)).toStrictEqual([LEASE_MS + 1000, 12_000]);
    });

    it(
        "leaves the queue to a drain 30 seconds later while Slack keeps failing",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { outbox, redis, scheduler, slack } = fakeOutbox();
            await redis.zAdd(QUEUE_KEY, queued("hello"));
            slack.respond(503, 503, 503, 503);

            await drive(outbox.deliverQueued());

            // Retried 1, 2 and 4 seconds apart within the drain, then due again 30 s after the last attempt.
            expect(sendTimes(slack.requests)).toStrictEqual([0, 1000, 3000, 7000]);
            expect(drains(scheduler.jobs)).toStrictEqual([LEASE_MS + 1000, 37_000]);
            expect(redis.keys()).toContain(QUEUE_KEY);
        },
    );

    it("schedules one later drain however many find the queue must wait", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, scheduler, slack } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("hello"));
        slack.respond(503, 503, 503, 503, 503, 503, 503, 503);

        await drive(outbox.deliverQueued());
        await drive(outbox.send({ text: "another" }));

        expect(drains(scheduler.jobs)).toStrictEqual([LEASE_MS + 1000, 37_000]);
    });

    it("retries a message at most three times in one drain", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, scheduler, slack } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("hello"));
        const slow = { retryAfterSeconds: 1 };
        slack.respond(slow, slow, slow, slow, slow);

        await drive(outbox.deliverQueued());

        // Then due again when Slack last asked, a second after the last attempt.
        expect(sendTimes(slack.requests)).toStrictEqual([0, 1000, 2000, 3000]);
        expect(drains(scheduler.jobs)).toStrictEqual([LEASE_MS + 1000, 4000]);
    });

    it("rejects when the queue cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis } = fakeOutbox();
        redis.zRange.mockRejectedValueOnce(new Error("redis down"));

        await expect(drive(outbox.deliverQueued())).rejects.toThrow("redis down");
        expect(redis.keys()).not.toContain(LEASE_KEY);
    });
});

// A drain can die holding the lease (Devvit ends a handler that runs too long), with messages queued for it.
describe("an outbox whose drain died", (): void => {
    it(
        "delivers nothing while the dead drain's lease lasts, and schedules a drain for after",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { outbox, redis, scheduler, slack } = fakeOutbox();
            await redis.set(LEASE_KEY, "a drain that died", { expiration: new Date(NOW.getTime() + LEASE_MS) });

            await drive(outbox.send({ text: "hello" }));

            expect(slack.requests).toStrictEqual([]);
            expect(drains(scheduler.jobs)).toStrictEqual([LEASE_MS + 1000]);
        },
    );

    it("delivers what was left once the lease has expired", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, slack } = fakeOutbox();
        await redis.set(LEASE_KEY, "a drain that died", { expiration: new Date(NOW.getTime() + LEASE_MS) });
        await drive(outbox.send({ text: "hello" }));
        await vi.advanceTimersByTimeAsync(LEASE_MS + 1000);

        await drive(outbox.deliverQueued());

        expect(texts(slack.messages)).toStrictEqual(["hello"]);
    });
});

// Slack takes about one message a second to a channel.
describe("messages sent one after another", (): void => {
    it(
        "reach Slack 1.1 seconds apart, though each is delivered by its own drain",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { outbox, slack } = fakeOutbox();

            await drive(outbox.send({ text: "first" }));
            await vi.advanceTimersByTimeAsync(500);
            await drive(outbox.send({ text: "second" }));

            expect(sendTimes(slack.requests)).toStrictEqual([0, 1100]);
        },
    );
});
