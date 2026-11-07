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
    it("include Slack refusing an alert, with its error code", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { health, outbox, slack } = fakeOutbox();
        slack.respond("not_in_channel");

        await drive(outbox.notifications({ text: "hello" }));

        expect(health.raise.mock.calls).toStrictEqual([["slack-refusing", "not_in_channel"]]);
    });

    // An answer from something between the app and Slack, such as an HTML error page, says nothing worth logging.
    it("give only the HTTP status of an answer that is not Slack's", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { health, outbox, slack } = fakeOutbox();
        slack.respond({ status: 404, body: "<html>Not Found</html>" });

        await drive(outbox.notifications({ text: "hello" }));

        expect(health.raise.mock.calls).toStrictEqual([["slack-refusing", "HTTP 404"]]);
    });

    it("give at most 100 characters of an error code", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { health, outbox, slack } = fakeOutbox();
        slack.respond({ status: 400, body: JSON.stringify({ ok: false, error: `${"x".repeat(100)}and more` }) });

        await drive(outbox.notifications({ text: "hello" }));

        expect(health.raise.mock.calls).toStrictEqual([["slack-refusing", "x".repeat(100)]]);
    });

    it.each([
        ["a server error", [503], "HTTP 503"],
        ["a failure Slack names", ["service_unavailable"], "service_unavailable"],
        ["rate limiting", [{ retryAfterSeconds: 1 }], "ratelimited"],
        ["a network error", [new Error("ECONNRESET")], "ECONNRESET"],
        ["a request that ran out of time", [new Error("context deadline exceeded")], "context deadline exceeded"],
    ] as const)(
        "include Slack not taking an alert after %s, with why",
        TEST_OPTIONS,
        async (_label: string, outcomes: readonly Outcome[], detail: string): Promise<void> => {
            expect.hasAssertions();

            const { health, outbox, slack } = fakeOutbox();
            slack.respond(...outcomes, ...outcomes, ...outcomes, ...outcomes);

            await drive(outbox.notifications({ text: "hello" }));

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

        await drive(outbox.notifications({ text: "one too many" }));

        expect(health.raise.mock.calls[0]).toStrictEqual(["outbox-full", "notification queue"]);
        expect(health.note.mock.calls[0]).toStrictEqual(["alert-dropped", 1]);
    });

    it("include an alert dropped after waiting a day", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { health, outbox, redis } = fakeOutbox();
        await redis.zAdd(QUEUE_KEY, queued("stale", DAY + 1));

        await drive(outbox.deliverQueued());

        expect(health.raise.mock.calls).toStrictEqual([["alerts-expired", ""]]);
        expect(health.note.mock.calls).toStrictEqual([["alert-dropped", 1]]);
    });

    // The Slack app may be in one channel and not the other: Slack refusing one doesn't end with the other's alerts.
    it(
        "include Slack refusing a channel, until an alert to that channel is taken",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { health, outbox, slack } = fakeOutbox();
            slack.respond("not_in_channel");

            await drive(outbox.notifications({ text: "refused", channel: "C0ALERTS" }));
            await drive(outbox.notifications({ text: "taken elsewhere", channel: "C0MODS" }));

            expect(health.clear.mock.calls).not.toContainEqual(["slack-refusing"]);

            await drive(outbox.notifications({ text: "taken there", channel: "C0ALERTS" }));

            expect(health.clear.mock.calls).toContainEqual(["slack-refusing"]);
        },
    );

    it(
        "end with an alert Slack takes, and those of the queue once it empties",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { health, outbox } = fakeOutbox();

            await drive(outbox.notifications({ text: "hello" }));

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
