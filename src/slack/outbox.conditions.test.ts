import { describe, expect, it } from "vitest";
import { drive } from "../../tests/fixtures/app.js";
import type { Outcome } from "../../tests/fixtures/fakeSlack.js";
import { outboxFakes } from "../../tests/fixtures/outbox.js";
import type { OutboxFakes } from "../../tests/fixtures/outbox.js";
import { createSlackOutbox } from "./outbox.js";
import type { SlackOutbox } from "./outbox.js";

const TEST_OPTIONS = { timeout: 5000 };

/** An outbox on fake Redis, scheduler and Slack, with the clock frozen at NOW. */
function fakeOutbox(): OutboxFakes & Readonly<{ outbox: SlackOutbox }> {
    const fakes = outboxFakes();
    return { ...fakes, outbox: createSlackOutbox(fakes.dependencies) };
}

// The outbox reports lasting delivery problems as conditions, which the health log reports once each.
describe("the conditions a drain reports", (): void => {
    it("include Slack refusing an alert, with Slack's answer", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { conditions, outbox, slack } = fakeOutbox();
        slack.respond(404);

        await drive(outbox.send({ text: "hello" }));

        expect(conditions.raise.mock.calls).toStrictEqual([["slack-refusing", "HTTP 404: error"]]);
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

            const { conditions, outbox, slack } = fakeOutbox();
            slack.respond(...outcomes, ...outcomes, ...outcomes, ...outcomes);

            await drive(outbox.send({ text: "hello" }));

            expect(conditions.raise.mock.calls).toStrictEqual([["slack-unreachable", detail]]);
        },
    );

    it("end with an alert Slack takes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { conditions, outbox } = fakeOutbox();

        await drive(outbox.send({ text: "hello" }));

        expect(conditions.raise).not.toHaveBeenCalled();
        expect(conditions.clear.mock.calls).toStrictEqual([["slack-refusing"], ["slack-unreachable"]]);
    });
});
