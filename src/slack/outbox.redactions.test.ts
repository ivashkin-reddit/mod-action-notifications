import { describe, expect, it } from "vitest";
import { drive, NOW } from "../../tests/fixtures/app.js";
import type { ZMember } from "../../tests/fixtures/fakeRedis.js";
import { outboxFakes, queued, sendTimes } from "../../tests/fixtures/outbox.js";
import type { OutboxFakes } from "../../tests/fixtures/outbox.js";
import { createSlackOutbox, forgetContent } from "./outbox.js";
import type { SlackOutbox } from "./outbox.js";

const TEST_OPTIONS = { timeout: 5000 };
const QUEUE_KEY = "slack_outbox";
const REDACTIONS_KEY = "slack_outbox_redactions";
const DAY = 86_400_000;

/** An outbox on fake Redis, scheduler and Slack, with the clock frozen at NOW. */
function fakeOutbox(): OutboxFakes & Readonly<{ outbox: SlackOutbox }> {
    const fakes = outboxFakes();
    return { ...fakes, outbox: createSlackOutbox(fakes.dependencies) };
}

/** A redaction of the alert at `ts` in the queue as a deletion left it, queued `ago` ms before NOW. */
function redaction(ts: string, ago = 0): ZMember {
    const queuedAt = NOW.getTime() - ago;
    return {
        member: JSON.stringify({ channel: "C0123MODS", ts, withoutQuotes: { text: `redacted ${ts}` }, queuedAt }),
        score: queuedAt,
    };
}

describe("a drain of the outbox with redactions waiting", (): void => {
    it(
        "delivers waiting alerts first, then makes the redactions, 1.1 seconds apart",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { outbox, redis, slack } = fakeOutbox();
            await redis.zAdd(REDACTIONS_KEY, redaction("1.000001"), redaction("1.000002", 1));
            await redis.zAdd(QUEUE_KEY, queued("waiting alert"));

            await drive(outbox.deliverQueued());

            expect(slack.requests.map(({ api }): string => api)).toStrictEqual([
                "chat.postMessage",
                "chat.update",
                "chat.update",
            ]);
            expect(slack.updates.map(({ ts }): string => ts)).toStrictEqual(["1.000002", "1.000001"]);
            expect(sendTimes(slack.requests)).toStrictEqual([0, 1100, 2200]);
        },
    );

    it.each([
        ["one that waited over a week", redaction("1.000001", 7 * DAY + 1), "waited a week"],
        ["one it cannot read", { member: "not JSON", score: NOW.getTime() }, "unreadable"],
    ])(
        "drops %s, and reports it",
        TEST_OPTIONS,
        async (_label: string, waiting: ZMember, detail: string): Promise<void> => {
            expect.hasAssertions();

            const { health, outbox, redis, slack } = fakeOutbox();
            await redis.zAdd(REDACTIONS_KEY, waiting);

            await drive(outbox.deliverQueued());

            expect(slack.requests).toStrictEqual([]);
            expect(health.raise.mock.calls).toStrictEqual([["redactions-failing", detail]]);
            expect(redis.keys()).not.toContain(REDACTIONS_KEY);
        },
    );
});

describe("a redaction Slack refuses to edit after the drain's time is up", (): void => {
    // A drain starts no request after its time: the lease outlasts its time by one request, not two.
    it("leaves the deletion that replaces the edit to a later drain", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, scheduler, slack } = fakeOutbox();
        await redis.zAdd(REDACTIONS_KEY, redaction("1.000001"));
        // Slack takes 15 seconds to refuse the edit: the drain's 10 seconds are then up.
        slack.respondSlowly(15_000, "edit_window_closed");

        await drive(outbox.deliverQueued());

        expect(slack.requests.map(({ api }): string => api)).toStrictEqual(["chat.update"]);
        expect(redis.keys()).toContain(REDACTIONS_KEY);
        expect(scheduler.runJob).toHaveBeenCalledWith(expect.objectContaining({ name: "slackOutbox" }));
    });
});

describe("content deleted on Reddit, quoted by alerts in Slack", (): void => {
    it("queues a redaction of each, and schedules a drain to make them", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { dependencies, redis, scheduler } = fakeOutbox();
        await redis.hSet("slack_outbox_sent:t1_a", {
            "C0123MODS 1.000001": JSON.stringify({ text: "removed t1_a" }),
            "C0456LOGS 1.000002": JSON.stringify({ text: "removed t1_a" }),
        });

        await forgetContent(dependencies, "t1_a");

        expect(redis.members(REDACTIONS_KEY).map((member: string): unknown => JSON.parse(member))).toStrictEqual([
            { channel: "C0123MODS", ts: "1.000001", withoutQuotes: { text: "removed t1_a" }, queuedAt: NOW.getTime() },
            { channel: "C0456LOGS", ts: "1.000002", withoutQuotes: { text: "removed t1_a" }, queuedAt: NOW.getTime() },
        ]);
        expect(redis.ttlSeconds(REDACTIONS_KEY)).toBe(7 * 86_400);
        expect(scheduler.jobs.map(({ name }): string => name)).toStrictEqual(["slackOutbox"]);
    });

    it(
        "keeps where the alerts are when their redactions cannot be queued, so the deletion can be handled again",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { dependencies, redis } = fakeOutbox();
            await redis.hSet("slack_outbox_sent:t1_a", {
                "C0123MODS 1.000001": JSON.stringify({ text: "removed t1_a" }),
            });
            redis.zAdd.mockResolvedValueOnce(1).mockRejectedValueOnce(new Error("redis down"));

            await expect(forgetContent(dependencies, "t1_a")).rejects.toThrow("redis down");
            await expect(redis.hGetAll("slack_outbox_sent:t1_a")).resolves.toStrictEqual({
                "C0123MODS 1.000001": JSON.stringify({ text: "removed t1_a" }),
            });
        },
    );

    it(
        "keeps at most 5,000 redactions waiting, and reports dropping the oldest",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { dependencies, health, redis } = fakeOutbox();
            await redis.zAdd(
                REDACTIONS_KEY,
                ...Array.from({ length: 5000 }, (_unused: unknown, index: number): ZMember =>
                    redaction(`0.${String(index)}`, DAY),
                ),
            );
            await redis.hSet("slack_outbox_sent:t1_a", {
                "C0123MODS 1.000001": JSON.stringify({ text: "removed t1_a" }),
            });

            await forgetContent(dependencies, "t1_a");

            await expect(redis.zCard(REDACTIONS_KEY)).resolves.toBe(5000);
            expect(health.raise.mock.calls).toStrictEqual([["redactions-failing", "too many waiting"]]);
        },
    );
});
