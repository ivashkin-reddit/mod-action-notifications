import { describe, expect, it } from "vitest";
import { drive } from "../../tests/fixtures/app.js";
import type { Outcome } from "../../tests/fixtures/fakeSlack.js";
import { outboxFakes, queued } from "../../tests/fixtures/outbox.js";
import type { OutboxFakes } from "../../tests/fixtures/outbox.js";
import { createSlackOutbox } from "./outbox.js";
import type { SlackOutbox } from "./outbox.js";

const TEST_OPTIONS = { timeout: 5000 };
const QUEUE_KEY = "slack_outbox";
const DAY = 86_400_000;

/** An outbox on fake Redis, scheduler and Slack, with the clock frozen at NOW. */
function fakeOutbox(): OutboxFakes & Readonly<{ outbox: SlackOutbox }> {
    const fakes = outboxFakes();
    return { ...fakes, outbox: createSlackOutbox(fakes.dependencies) };
}

// The outbox reports lasting delivery problems as conditions, which the health log reports once each.
describe("the conditions a drain reports", (): void => {
    it("include Slack refusing an alert, with Slack's answer", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { health, outbox, slack } = fakeOutbox();
        slack.respond(404);

        await drive(outbox.send({ text: "hello" }));

        expect(health.raise.mock.calls).toStrictEqual([["slack-refusing", "HTTP 404: error"]]);
    });

    // An answer from something between the app and Slack, such as an HTML error page, must not fill the log.
    it("give at most 100 characters of Slack's answer", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { health, outbox, slack } = fakeOutbox();
        slack.respond({ status: 404, body: `${"x".repeat(100)}and more` });

        await drive(outbox.send({ text: "hello" }));

        expect(health.raise.mock.calls).toStrictEqual([["slack-refusing", `HTTP 404: ${"x".repeat(100)}`]]);
    });

    it.each([
        ["a server error", [503, 503, 503, 503], "HTTP 503: error"],
        ["a network error", [new Error("ECONNRESET")], "ECONNRESET"],
        ["a request that ran out of time", [new Error("context deadline exceeded")], "context deadline exceeded"],
    ] as const)(
        "include Slack not taking an alert after %s, with why",
        TEST_OPTIONS,
        async (_label: string, outcomes: readonly Outcome[], detail: string): Promise<void> => {
            expect.hasAssertions();

            const { health, outbox, slack } = fakeOutbox();
            slack.respond(...outcomes, ...outcomes, ...outcomes, ...outcomes);

            await drive(outbox.send({ text: "hello" }));

            expect(health.raise.mock.calls).toStrictEqual([["slack-unreachable", detail]]);
        },
    );

    it("include the queue being full, as a new alert pushes out the oldest", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { health, outbox, redis, slack } = fakeOutbox();
        for (let index = 0; index < 500; index += 1) {
            await redis.zAdd(QUEUE_KEY, queued(`m${String(index)}`, 500 - index));
        }
        slack.respond(503, 503, 503, 503);

        await drive(outbox.send({ text: "one too many" }));

        expect(health.raise.mock.calls[0]).toStrictEqual(["outbox-full", ""]);
    });

    it("include an alert dropped after waiting a day", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { health, outbox, redis } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("stale", DAY + 1));

        await drive(outbox.deliverQueued());

        expect(health.raise.mock.calls).toStrictEqual([["alerts-expired", ""]]);
    });

    it(
        "end with an alert Slack takes, and those of the queue once it empties",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { health, outbox } = fakeOutbox();

            await drive(outbox.send({ text: "hello" }));

            expect(health.raise).not.toHaveBeenCalled();
            expect(health.clear.mock.calls).toStrictEqual([
                ["slack-refusing"],
                ["slack-unreachable"],
                ["outbox-full"],
                ["alerts-expired"],
            ]);
        },
    );
});
