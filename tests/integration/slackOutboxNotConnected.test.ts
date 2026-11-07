import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const QUEUE_KEY = "slack_outbox";
const DRAIN_SCHEDULED_KEY = "slack_outbox_drain_scheduled";

// No drain delivers while Slack is not connected: what is queued waits for a connection.
describe("the Slack outbox while Slack is not connected", (): void => {
    it("waits, without delivering", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { connectedToken: "" });
        await app.context.redis.zAdd(QUEUE_KEY, {
            member: JSON.stringify({ id: "queued", queuedAt: NOW.getTime(), message: { text: "queued" } }),
            score: NOW.getTime(),
        });

        await app.runJob("slackOutbox");

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.redis.keys()).toContain(QUEUE_KEY);
    });

    // A run that has started covers no later drain: one scheduled once Slack is connected again must be scheduled.
    it("lets a later drain be scheduled once a run has found it so", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { connectedToken: "" });
        await app.context.redis.set(DRAIN_SCHEDULED_KEY, NOW.toISOString());

        await app.runJob("slackOutbox");

        expect(app.context.redis.keys()).not.toContain(DRAIN_SCHEDULED_KEY);
    });
});
