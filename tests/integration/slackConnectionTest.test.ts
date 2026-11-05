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

        expect(definition.title).toBe("Mod Action Notifications");
        expect(definition.acceptLabel).toBe("Send Test Alert");
        expect(definition.fields.map((field): string => field.name)).toStrictEqual(["info"]);
    });

    it("sends a test message to the notification channel and confirms it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { notificationChannel: "mod-log" });

        await app.fillForm("Test Slack Connection", {});

        expect(app.slack.messages).toStrictEqual([
            {
                text: "🧪 Test message from Mod Action Notifications",
                username: "Mod Action Notifications (Test)",
                icon_emoji: ":robot_face:",
                channel: "#mod-log",
                attachments: [
                    {
                        color: "#00ff00",
                        fields: [
                            { title: "Status", value: "The app is working correctly!", short: true },
                            { title: "Timestamp", value: NOW.toISOString(), short: true },
                        ],
                        footer: "Mod Action Notifications - Test Message",
                    },
                ],
            },
        ]);
        expect(app.toasts).toStrictEqual([
            { text: "🧪 Test alert sent! Check your Slack channel and bot logs.", appearance: "success" },
        ]);
    });

    it("says when no bot token is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackBotToken: "" });

        await app.fillForm("Test Slack Connection", {});

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.toasts).toStrictEqual([
            { text: "⚠️ No Slack bot token is set. The app's developer sets it.", appearance: "neutral" },
        ]);
    });

    it("says when no notification channel is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { notificationChannel: "" });

        await app.fillForm("Test Slack Connection", {});

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.toasts).toStrictEqual([
            { text: "⚠️ No Notification Channel is set. Set it in the app's settings.", appearance: "neutral" },
        ]);
    });

    it("says when Slack does not accept the test", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond("not_in_channel");

        await app.fillForm("Test Slack Connection", {});

        expect(app.slack.requests).toHaveLength(1);
        expect(app.toasts).toStrictEqual([
            {
                text: "❌ Slack did not accept the test alert. Check the Notification Channel, and that the Slack app is in it.",
                appearance: "neutral",
            },
        ]);
        expect(console.warn).toHaveBeenCalledExactlyOnceWith(
            "[slack] Slack did not take a message sent straight to it (not_in_channel). Check the channel in the app's settings, and that the Slack app has been added to it.",
        );
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
