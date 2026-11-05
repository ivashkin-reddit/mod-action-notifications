import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("the Test Slack Connection menu item", (): void => {
    it("opens the test form", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.pressMenuItem("Test Slack Connection");

        const { definition } = app.shownForm();

        expect(definition.title).toBe("Reddit Mod Action Bot");
        expect(definition.acceptLabel).toBe("Send Test Alert");
        expect(definition.fields.map((field): string => field.name)).toStrictEqual(["info"]);
    });

    // The test message carries no channel, so it goes to the webhook's own channel whatever the settings say.
    it("sends a test message to the webhook’s own channel and confirms it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { notificationChannel: "mod-log" });

        await app.fillForm("Test Slack Connection", {});

        expect(app.slack.messages).toStrictEqual([
            {
                text: "🧪 Test message from Reddit Mod Action Bot",
                username: "Reddit Mod Bot (Test)",
                icon_emoji: ":robot_face:",
                attachments: [
                    {
                        color: "#00ff00",
                        fields: [
                            { title: "Status", value: "Bot is working correctly!", short: true },
                            { title: "Timestamp", value: NOW.toISOString(), short: true },
                        ],
                        footer: "Reddit Mod Action Bot - Test Message",
                    },
                ],
            },
        ]);
        expect(app.toasts).toStrictEqual([
            { text: "🧪 Test alert sent! Check your Slack channel and bot logs.", appearance: "success" },
        ]);
    });

    it("says when no webhook is configured", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: "" });

        await app.fillForm("Test Slack Connection", {});

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.toasts).toStrictEqual([
            { text: "⚠️ No Slack webhook URL is set. Add one in the app's settings.", appearance: "neutral" },
        ]);
    });

    it("says when Slack does not accept the test", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(404);

        await app.fillForm("Test Slack Connection", {});

        expect(app.slack.requests).toHaveLength(1);
        expect(app.toasts).toStrictEqual([
            {
                text: "❌ Slack did not accept the test alert. Check the webhook URL and the bot logs.",
                appearance: "neutral",
            },
        ]);
    });

    it("retries a test Slack could not take at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(503);

        await app.fillForm("Test Slack Connection", {});

        expect(app.slack.requests.map((request): number => request.sentAt - NOW.getTime())).toStrictEqual([0, 1000]);
        expect(app.toasts[0]?.appearance).toBe("success");
    });
});
