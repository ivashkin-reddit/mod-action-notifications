import { describe, expect, it } from "vitest";
import { drive } from "../../tests/fixtures/app.js";
import { outboxFakes, queued, texts } from "../../tests/fixtures/outbox.js";
import type { OutboxFakes } from "../../tests/fixtures/outbox.js";
import { createSlackOutbox } from "./outbox.js";
import type { SlackOutbox } from "./outbox.js";

const TEST_OPTIONS = { timeout: 5000 };
const QUEUE_KEY = "slack_outbox";

/** An outbox on fake Redis, scheduler and Slack, with the clock frozen at NOW. */
function fakeOutbox(): OutboxFakes & Readonly<{ outbox: SlackOutbox }> {
    const fakes = outboxFakes();
    return { ...fakes, outbox: createSlackOutbox(fakes.dependencies) };
}

// The scheduler can fail: a recovery drain is a safety net, and delivery goes on without it.
describe("an outbox whose scheduler fails", (): void => {
    it(
        "still delivers when the recovery drain cannot be scheduled, and lets the next drain schedule it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { outbox, redis, scheduler, slack } = fakeOutbox();
            const failure = new Error("scheduler down");
            scheduler.runJob.mockRejectedValueOnce(failure);

            await drive(outbox.send({ text: "hello" }));

            expect(texts(slack.messages)).toStrictEqual(["hello"]);
            expect(redis.keys()).not.toContain("slack_outbox_recovery_scheduled");
            expect(console.warn).toHaveBeenCalledWith(
                "[outbox] Could not schedule a recovery drain, so delivering without one:",
                failure,
            );
        },
    );

    it("lets the next drain schedule a continuation that could not be", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { outbox, redis, scheduler, slack } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("one"));
        slack.respond({ retryAfterSeconds: 30 });
        // The recovery is scheduled; the continuation after Slack's rate limit is not.
        scheduler.runJob.mockResolvedValueOnce("job-1").mockRejectedValueOnce(new Error("scheduler down"));

        await expect(drive(outbox.deliverQueued())).rejects.toThrow("scheduler down");
        expect(redis.keys()).not.toContain("slack_outbox_drain_scheduled");
    });
});
