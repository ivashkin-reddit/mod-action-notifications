import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import { WEBHOOK_URL } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const DAY_SECONDS = 86_400;
const DAY = DAY_SECONDS * 1000;
const NO_WEBHOOK = "[health] No Slack webhook URL is set, so no alerts are sent. Set one in the app's settings.";

// A problem that lasts is logged when it starts, not each time the app meets it: Devvit keeps only 5,000 log entries.
describe("a missing webhook", (): void => {
    it("is logged once, however many mod actions find it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: undefined });

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_3" }));

        expect(console.warn).toHaveBeenCalledExactlyOnceWith(NO_WEBHOOK);
        expect(console.error).not.toHaveBeenCalled();
    });

    it("is logged again each day it lasts, saying since when", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: undefined });
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.advance(DAY - 1);
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));
        await app.advance(1);

        await app.fire("ModAction", removedPost({ id: "ModAction_3" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_4" }));

        expect(vi.mocked(console.warn).mock.calls).toStrictEqual([
            [NO_WEBHOOK],
            [NO_WEBHOOK.replace("[health] ", "[health] Since 2026-11-04T12:00:00.000Z: ")],
        ]);
    });

    // Stored data: renaming these keys would lose what installations hold.
    it(
        "is kept in Redis for a week from when it was last met, with its daily reminder",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { slackWebhookUrl: undefined });

            await app.fire("ModAction", removedPost());

            await expect(app.context.redis.hGetAll("health:conditions")).resolves.toStrictEqual({
                "webhook-missing": String(NOW.getTime()),
            });
            expect(app.context.redis.ttlSeconds("health:conditions")).toBe(7 * DAY_SECONDS);
            expect(app.context.redis.ttlSeconds("health:reminder:webhook-missing")).toBe(DAY_SECONDS);
        },
    );

    it("is logged as resolved once a webhook is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: undefined });
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        app.settings.slackWebhookUrl = WEBHOOK_URL;

        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_3" }));

        expect(console.info).toHaveBeenCalledExactlyOnceWith(
            "[health] A Slack webhook URL is set: alerts are sent again.",
        );
    });
});

// A URL saved before the app checked it on saving.
describe("a webhook URL that is not a Slack one", (): void => {
    it("is logged once, as an error, however many mod actions find it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: "https://example.com/hook" });

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        expect(console.error).toHaveBeenCalledExactlyOnceWith(
            "[health] The Slack webhook URL is not an https://hooks.slack.com/ URL, so no alerts are sent. Correct it in the app's settings.",
        );
        expect(console.warn).not.toHaveBeenCalled();
    });
});

describe("a Slack that refuses alerts", (): void => {
    it("is logged once, as an error, and as resolved once Slack takes one", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(404, 404);
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        await app.fire("ModAction", removedPost({ id: "ModAction_3" }));

        expect(console.error).toHaveBeenCalledExactlyOnceWith(
            "[health] Slack is refusing alerts (HTTP 404: error), so they are dropped. Check the webhook URL in the app's settings, then use Test Slack Connection.",
        );
        expect(console.info).toHaveBeenCalledExactlyOnceWith("[health] Slack is taking alerts again.");
    });
});

describe("recording a condition", (): void => {
    it("never stops an alert, and says so when Redis fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("redis down");
        app.context.redis.hDel.mockRejectedValueOnce(failure);

        await app.fire("ModAction", removedPost());

        expect(app.slack.messages).toHaveLength(1);
        expect(console.warn).toHaveBeenCalledExactlyOnceWith("[health] Could not record a condition:", {
            condition: "webhook-missing",
            error: failure,
        });
    });
});
