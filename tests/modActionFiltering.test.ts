import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./support/app.js";
import { removedPost } from "./support/events.js";
import { WEBHOOK_URL } from "./support/fakeContext.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";
import { lastLine, lines, MINUTE, onlyMessage } from "./support/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("which mod actions are sent", (): void => {
    it("sends nothing when no webhook is configured", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: undefined });

        await app.fire("ModAction", removedPost());

        expect(app.slack.requests).toStrictEqual([]);
        expect(console.error).toHaveBeenCalledWith("Slack webhook URL not configured - skipping notification");
    });

    it("refuses a webhook URL that is not https", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: "http://hooks.slack.com/services/T000/B000/XXXX" });

        await app.fire("ModAction", removedPost());

        expect(app.slack.requests).toStrictEqual([]);
        expect(console.error).toHaveBeenCalledWith("Invalid Slack webhook URL: must start with https://");
    });

    it("trims spaces around the webhook URL", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: `  ${WEBHOOK_URL}  ` });

        await app.fire("ModAction", removedPost());

        expect(app.slack.requests[0]?.url).toBe(WEBHOOK_URL);
    });

    it("sends nothing for an action type that is not enabled", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ action: "lock" }));

        expect(app.slack.requests).toStrictEqual([]);
    });

    it(
        "treats an enabled-actions setting that is not a list as nothing enabled",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { enabledActions: "removelink" });

            await app.fire("ModAction", removedPost());

            expect(app.slack.requests).toStrictEqual([]);
        },
    );

    it(
        "skips excluded moderators, matching the comma-separated names case-insensitively",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { excludedModerators: " moda , SomeBot ,, " });

            await app.fire("ModAction", removedPost());
            await app.fire("ModAction", removedPost({ moderator: { name: "ModB" } }));

            expect(lines(onlyMessage(app.slack.messages))[2]).toBe(
                "• *Moderator:* <https://www.reddit.com/u/ModB|u/ModB>",
            );
        },
    );

    it("sends nothing when the settings cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        vi.mocked(app.context.settings.get).mockRejectedValue(new Error("settings unavailable"));

        await app.fire("ModAction", removedPost());

        expect(app.slack.requests).toStrictEqual([]);
        expect(console.error).toHaveBeenCalledWith(
            "Failed to load configuration - check settings format and values:",
            new Error("settings unavailable"),
        );
    });
});

describe("an action by someone not on the mod list", (): void => {
    it("is sent as a security alert to the alert channel", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { alertChannel: "security", notificationChannel: "mod-log" });

        await app.fire("ModAction", removedPost({ moderator: { name: "Intruder" } }));

        const message = onlyMessage(app.slack.messages);

        expect(message).toMatchObject({
            text: "🚨 SECURITY ALERT: 🗑️ Post Removed by unknown moderator",
            icon_emoji: ":warning:",
            channel: "#security",
            attachments: [{ color: "#ff0000" }],
        });
        expect([lines(message)[0], lastLine(message)]).toStrictEqual([
            "🚨 *Security Alert*",
            "• *Status:* Unknown moderator (alert)",
        ]);
        expect(console.warn).toHaveBeenCalledWith("Mod action by unknown moderator", {
            moderator: "Intruder",
            action: "removelink",
        });
    });

    it("goes to the notification channel when no alert channel is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { notificationChannel: "mod-log" });

        await app.fire("ModAction", removedPost({ moderator: { name: "Intruder" } }));

        expect(onlyMessage(app.slack.messages).channel).toBe("#mod-log");
    });

    it("is not flagged when the moderator’s name differs only in case", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ moderator: { name: "moda" } }));

        expect(onlyMessage(app.slack.messages).text).toBe("🗑️ Post Removed");
    });

    it("is sent as a normal message when flagging unknown moderators is off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { flagUnknownModerators: false });

        await app.fire("ModAction", removedPost({ moderator: { name: "Intruder" } }));

        expect(onlyMessage(app.slack.messages).text).toBe("🗑️ Post Removed");
        expect(app.context.reddit.getModerators).not.toHaveBeenCalled();
    });

    it("is treated as by a moderator when the mod list cannot be fetched", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.moderatorsAll.mockRejectedValue(new Error("reddit down"));

        await app.fire("ModAction", removedPost({ moderator: { name: "Intruder" } }));

        expect(onlyMessage(app.slack.messages).text).toBe("🗑️ Post Removed");
        expect(console.error).toHaveBeenCalledWith("Failed to fetch moderator list:", new Error("reddit down"));
    });
});

describe("the mod list", (): void => {
    it("is fetched once and reused for five minutes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost());
        await app.advance(5 * MINUTE - 1);
        await app.fire("ModAction", removedPost());

        expect(app.context.reddit.getModerators).toHaveBeenCalledExactlyOnceWith();

        await app.advance(1);
        await app.fire("ModAction", removedPost());

        expect(app.context.reddit.getModerators).toHaveBeenCalledTimes(2);
    });
});

describe("autoModerator actions", (): void => {
    it("are not sent by default", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.moderators = ["ModA", "AutoModerator"];

        await app.fire("ModAction", removedPost({ moderator: { name: "AutoModerator" } }));

        expect(app.slack.requests).toStrictEqual([]);
    });

    it(
        "are sent, marked as from AutoModerator, when AutoModerator alerts are on",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { enableAutoModAlerts: true });
            app.context.reddit.moderators = ["ModA", "AutoModerator"];

            await app.fire("ModAction", removedPost({ moderator: { name: "AutoModerator" } }));

            expect(lastLine(onlyMessage(app.slack.messages))).toBe("• *Status:* Origin AutoModerator");
        },
    );

    it("do not count toward a moderator activity spike", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enableAutoModAlerts: true });
        app.context.reddit.moderators = ["ModA", "AutoModerator"];

        for (let count = 0; count < 6; count += 1) {
            await app.fire("ModAction", removedPost({ moderator: { name: "AutoModerator" } }));
        }

        expect(app.slack.messages.map((message): string | undefined => lastLine(message))).toStrictEqual(
            Array<string>(6).fill("• *Status:* Origin AutoModerator"),
        );
        expect(app.context.redis.keys()).toStrictEqual([]);
    });
});
