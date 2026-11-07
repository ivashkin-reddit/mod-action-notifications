import { describe, expect, it } from "vitest";
import { drive, NOW } from "../../tests/fixtures/app.js";
import { outboxFakes, queued, queuedQuoting, texts } from "../../tests/fixtures/outbox.js";
import type { OutboxFakes } from "../../tests/fixtures/outbox.js";
import { createSlackOutbox, forgetContent } from "./outbox.js";
import type { SlackOutbox } from "./outbox.js";
import { queueState } from "./queue.js";

const TEST_OPTIONS = { timeout: 5000 };
const ALERTS_KEY = "slack_outbox_alerts";
const NOTIFICATIONS_KEY = "slack_outbox";
const LEASE_KEY = "slack_outbox_lease";
/** The lease: a drain's 10 s budget, a 1.1 s pause, Devvit's 30 s fetch timeout and a 5 s margin. */
const LEASE_MS = 46_100;
const MINUTE = 60_000;

/** An outbox on fake Redis, scheduler and Slack, with the clock frozen at NOW. */
function fakeOutbox(): OutboxFakes & Readonly<{ outbox: SlackOutbox }> {
    const fakes = outboxFakes();
    return { ...fakes, outbox: createSlackOutbox(fakes.dependencies) };
}

describe("the alert and notification queues", (): void => {
    it("deliver every waiting alert before any notification", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, slack } = fakeOutbox();
        await redis.zAdd(NOTIFICATIONS_KEY, queued("first notification", 3 * MINUTE), queued("second", 2 * MINUTE));
        await redis.zAdd(ALERTS_KEY, queued("late alert", MINUTE));

        await drive(outbox.deliverQueued());

        expect(texts(slack.messages)).toStrictEqual(["late alert", "first notification", "second"]);
    });

    it("queue each sender's messages in its own queue", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis } = fakeOutbox();
        // Another drain holds the queue, so what is sent only queues.
        await redis.set(LEASE_KEY, "another drain", { expiration: new Date(NOW.getTime() + LEASE_MS) });

        await drive(outbox.alerts({ text: "urgent" }));
        await drive(outbox.notifications({ text: "routine" }));

        expect(redis.members(ALERTS_KEY).join()).toContain("urgent");
        expect(redis.members(NOTIFICATIONS_KEY).join()).toContain("routine");
        expect(redis.members(ALERTS_KEY).join()).not.toContain("routine");
    });

    it(
        "each keep 500, so a full notification queue never pushes out an alert",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { health, outbox, redis } = fakeOutbox();
            // Another drain holds the queue, so what is sent only queues.
            await redis.set(LEASE_KEY, "another drain", { expiration: new Date(NOW.getTime() + LEASE_MS) });
            await redis.zAdd(ALERTS_KEY, queued("waiting alert", MINUTE));
            for (let index = 0; index < 500; index += 1) {
                await redis.zAdd(NOTIFICATIONS_KEY, queued(`old ${String(index)}`, MINUTE - index));
            }

            await drive(outbox.notifications({ text: "newest" }));

            expect(redis.members(ALERTS_KEY)).toHaveLength(1);
            expect(redis.members(NOTIFICATIONS_KEY)).toHaveLength(500);
            expect(redis.members(NOTIFICATIONS_KEY)[0]).toContain('"id":"old 1"');
            expect(health.raise).toHaveBeenCalledWith("outbox-full", "notification queue");
        },
    );

    it("name the alert queue when it is the one full", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { health, outbox, redis } = fakeOutbox();
        // Another drain holds the queue, so what is sent only queues.
        await redis.set(LEASE_KEY, "another drain", { expiration: new Date(NOW.getTime() + LEASE_MS) });
        for (let index = 0; index < 500; index += 1) {
            await redis.zAdd(ALERTS_KEY, queued(`old ${String(index)}`, MINUTE - index));
        }

        await drive(outbox.alerts({ text: "newest" }));

        expect(redis.members(ALERTS_KEY)).toHaveLength(500);
        expect(health.raise).toHaveBeenCalledWith("outbox-full", "alert queue");
    });

    it(
        "both lose the quotes of deleted content, each message in its own queue",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { dependencies, redis } = fakeOutbox();
            await redis.zAdd(ALERTS_KEY, queuedQuoting("t1_a", 2));
            await redis.zAdd(NOTIFICATIONS_KEY, queuedQuoting("t1_a", 1));

            await forgetContent(dependencies, "t1_a");

            const [alert] = redis.members(ALERTS_KEY);
            const [notification] = redis.members(NOTIFICATIONS_KEY);

            expect(alert).toContain("removed t1_a");
            expect(alert).not.toContain("said");
            expect(notification).toContain("removed t1_a");
            expect(notification).not.toContain("said");
        },
    );

    it("say how many wait in each, and since when", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { redis } = fakeOutbox();
        await redis.zAdd(ALERTS_KEY, queued("alert", MINUTE));
        await redis.zAdd(NOTIFICATIONS_KEY, queued("older", 2 * MINUTE), queued("newer", MINUTE));

        await expect(queueState(redis)).resolves.toStrictEqual({
            alerts: { waiting: 1, oldestQueuedAt: NOW.getTime() - MINUTE },
            notifications: { waiting: 2, oldestQueuedAt: NOW.getTime() - 2 * MINUTE },
        });
    });
});
