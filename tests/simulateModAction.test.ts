import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./support/app.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";
import { lastLine, lines, WHEN_NOW } from "./support/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("the Simulate Mod Action menu item", (): void => {
    it("opens the simulation form", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.pressMenuItem("Simulate Mod Action");

        const { definition } = app.shownForm();

        expect(definition.title).toBe("Simulate Mod Action");
        expect(definition.fields.map((field): string => field.name)).toStrictEqual([
            "actionType",
            "moderatorName",
            "targetUser",
            "includeModNote",
            "modNote",
            "banDuration",
            "customDetails",
            "slackChannel",
        ]);
        expect(definition.fields[0]?.options?.map((option): string => option.value)).toStrictEqual([
            "removelink",
            "removecomment",
            "banuser",
            "unbanuser",
            "muteuser",
            "unmuteuser",
        ]);
    });

    it(
        "sends a simulated ban, without checking the mod list or touching stored data",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fillForm("Simulate Mod Action", {
                actionType: ["banuser"],
                moderatorName: " SimMod ",
                targetUser: " Victim ",
                includeModNote: true,
                modNote: "Testing",
                banDuration: 7,
                customDetails: "",
                slackChannel: "mods",
            });

            const [message] = app.slack.messages;

            expect(message).toMatchObject({ text: "🔨 User Banned", channel: "#mods" });
            expect(lines(message)).toStrictEqual([
                "🔔 *Moderator Action*",
                "• *Action:* User Banned",
                "• *Moderator:* <https://www.reddit.com/u/SimMod|u/SimMod>",
                "• *Target:* <https://www.reddit.com/u/Victim|u/Victim>",
                WHEN_NOW,
                "• *Ban Duration:* 7 days",
                "• *Details:* 7 days",
                "• *Mod Note:* Testing",
            ]);
            expect(app.context.reddit.getModerators).not.toHaveBeenCalled();
            expect(app.context.redis.keys()).toStrictEqual([]);
            expect(app.toasts).toStrictEqual([{ text: "✅ Simulation delivered to Slack!", appearance: "success" }]);
        },
    );

    it("sends a post removal by SimulationMod when the form is left blank", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { notificationChannel: "mod-log" });

        await app.fillForm("Simulate Mod Action", {});

        const [message] = app.slack.messages;

        expect(message?.text).toBe("🗑️ Post Removed");
        expect(message?.channel).toBe("#mod-log");
        expect(lines(message)).toStrictEqual([
            "🔔 *Moderator Action*",
            "• *Action:* Post Removed",
            "• *Moderator:* <https://www.reddit.com/u/SimulationMod|u/SimulationMod>",
            WHEN_NOW,
        ]);
    });

    it.each([
        [{ includeModNote: true }, "• *Mod Note:* Simulation note"],
        [{ includeModNote: false, modNote: "Ignored" }, WHEN_NOW],
        [{ customDetails: " extra " }, "• *Details:* extra"],
        [{ moderatorName: "AutoModerator" }, "• *Status:* Origin AutoModerator"],
    ])(
        "ends a simulated removal for %j with %j",
        TEST_OPTIONS,
        async (values: Readonly<Record<string, unknown>>, expectedLastLine: string): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fillForm("Simulate Mod Action", values);

            expect(lastLine(app.slack.messages[0])).toBe(expectedLastLine);
        },
    );

    it("keeps a channel that already starts with #", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fillForm("Simulate Mod Action", { slackChannel: "#already" });

        expect(app.slack.messages[0]?.channel).toBe("#already");
    });

    it.each([
        [{ banDuration: 1 }, ["• *Ban Duration:* 1 day", "• *Details:* 1 day"]],
        [{ banDuration: -3 }, ["• *Ban Duration:* Unknown Duration"]],
        [{ banDuration: -3, customDetails: "two weeks" }, ["• *Ban Duration:* two weeks", "• *Details:* two weeks"]],
        [
            { banDuration: -3, includeModNote: true, modNote: "banned 5 day" },
            ["• *Ban Duration:* 5 days", "• *Mod Note:* banned 5 day"],
        ],
    ])(
        "describes a simulated ban with %j",
        TEST_OPTIONS,
        async (values: Readonly<Record<string, unknown>>, expectedLines: readonly string[]): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fillForm("Simulate Mod Action", { actionType: ["banuser"], ...values });

            // Header, action, moderator and time come first; a simulation without a target user has no target line.
            expect(lines(app.slack.messages[0]).slice(4)).toStrictEqual(expectedLines);
        },
    );

    it("reports that it cannot send without a webhook", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: "" });

        await app.fillForm("Simulate Mod Action", {});

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.toasts).toStrictEqual([
            { text: "❌ Could not send simulation. Check logs.", appearance: "neutral" },
        ]);
        expect(console.error).toHaveBeenCalledWith(
            "Failed to send simulated action",
            new Error("Slack webhook URL is not configured"),
        );
    });
});
