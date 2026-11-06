import { describe, expect, it, vi } from "vitest";
import devvitJson from "../../devvit.json" with { type: "json" };
import { loadApp } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

function byText(first: string, second: string): number {
    return first.localeCompare(second);
}

describe("what the app registers with Devvit", (): void => {
    // Setting names are stored per installation: renaming one loses every moderator's saved value.
    it(
        "registers the settings moderators configure, with their names, types and defaults",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            expect(
                app.registrations.settings.map(
                    ({ name, type, defaultValue }): { name: string; type: string; defaultValue: unknown } => ({
                        name,
                        type,
                        defaultValue,
                    }),
                ),
            ).toStrictEqual([
                { name: "slackBotToken", type: "string", defaultValue: undefined },
                {
                    name: "enabledActions",
                    type: "select",
                    defaultValue: ["removelink", "removecomment", "spamlink", "spamcomment", "banuser", "unbanuser"],
                },
                { name: "excludedModerators", type: "string", defaultValue: undefined },
                { name: "flagUnknownModerators", type: "boolean", defaultValue: true },
                { name: "securityAlerts", type: "boolean", defaultValue: true },
                { name: "includeModNote", type: "boolean", defaultValue: true },
                { name: "banHistoryDays", type: "number", defaultValue: 30 },
                { name: "notificationChannel", type: "string", defaultValue: undefined },
                { name: "alertChannel", type: "string", defaultValue: undefined },
                { name: "slackRetentionDays", type: "number", defaultValue: 90 },
                { name: "modqueueThreshold", type: "number", defaultValue: 50 },
                { name: "unmoderagedAgeHours", type: "number", defaultValue: 24 },
                { name: "reportedContentAgeHours", type: "number", defaultValue: 24 },
                { name: "spamQueueThreshold", type: "number", defaultValue: 0 },
                { name: "editedQueueThreshold", type: "number", defaultValue: 0 },
                { name: "enableAutoModAlerts", type: "boolean", defaultValue: false },
                { name: "postDeletionUpvoteThreshold", type: "number", defaultValue: 100 },
                { name: "dailySummary", type: "boolean", defaultValue: false },
                { name: "weeklyStatistics", type: "boolean", defaultValue: false },
            ]);
        },
    );

    // Devvit encrypts a secret, and only the developer can set it, from the command line: moderators never see it.
    it(
        "registers the Slack bot token as a secret the developer sets for the whole app",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            expect(
                app.registrations.settings
                    .filter(({ isSecret }): boolean => isSecret === true)
                    .map(({ name, scope }): { name: string; scope: string | undefined } => ({ name, scope })),
            ).toStrictEqual([{ name: "slackBotToken", scope: "app" }]);
        },
    );

    it("offers every mod action type the Slack messages know how to name", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const enabledActions = app.registrations.settings.find((setting): boolean => setting.name === "enabledActions");

        expect(enabledActions?.multiSelect).toBe(true);
        expect(enabledActions?.options?.map((option): string => option.value)).toStrictEqual([
            "removelink",
            "removecomment",
            "spamlink",
            "spamcomment",
            "approvelink",
            "approvecomment",
            "banuser",
            "unbanuser",
            "lock",
            "unlock",
            "sticky",
            "unsticky",
            "editflair",
            "muteuser",
            "unmuteuser",
            "distinguish",
            "ignorereports",
            "unignorereports",
            "snoozereports",
            "unsnoozereports",
            "addcontributor",
            "removecontributor",
            "invitemoderator",
            "uninvitemoderator",
            "acceptmoderatorinvite",
            "addmoderator",
            "removemoderator",
            "editsettings",
            "adjust_post_crowd_control_level",
            "enable_post_crowd_control_filter",
            "disable_post_crowd_control_filter",
            "setpermissions",
            "wikirevise",
            "createrule",
            "editrule",
            "deleterule",
            "reorderrules",
            "edit_post_requirements",
            "dev_platform_app_installed",
            "dev_platform_app_uninstalled",
            "dev_platform_app_enabled",
            "dev_platform_app_disabled",
            "dev_platform_app_changed",
        ]);
    });

    // Devvit 0.15 routes only the triggers devvit.json lists to a Blocks app.
    it("handles exactly the triggers devvit.json subscribes to", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        const registered = Object.keys(app.registrations.triggers)
            .map((event): string => `on${event}`)
            .sort(byText);

        expect(registered).toStrictEqual([...devvitJson.blocks.triggers].sort(byText));
        expect(registered).toStrictEqual([
            "onAppInstall",
            "onAppUpgrade",
            "onCommentDelete",
            "onModAction",
            "onPostDelete",
        ]);
    });

    // Devvit 0.15 grants a Blocks app only the permissions devvit.json declares, whatever Devvit.configure says.
    it("is granted in devvit.json what it asks for in Devvit.configure", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const { permissions, blocks } = devvitJson;

        expect(app.registrations.configure).toStrictEqual([
            { redditAPI: true, http: { domains: ["slack.com"] }, redis: true },
        ]);
        expect(permissions).toStrictEqual({
            http: { enable: true, domains: ["slack.com"] },
            redis: true,
            reddit: true,
        });
        expect(blocks.entry).toBe("src/main.ts");
    });

    // Scheduler job names are stored with every scheduled job: renaming one orphans the jobs already scheduled.
    it(
        "registers the modqueue monitor, the Slack outbox, the daily summary and the weekly statistics as its scheduler jobs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            expect(Object.keys(app.registrations.schedulerJobs)).toStrictEqual([
                "modqueueMonitor",
                "slackOutbox",
                "dailySummary",
                "weeklyStatistics",
            ]);
        },
    );

    it("adds five subreddit menu items, shown to moderators only", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        expect(
            app.registrations.menuItems.map(
                ({
                    label,
                    location,
                    forUserType,
                }): { label: string; location: string; forUserType: string | undefined } => ({
                    label,
                    location,
                    forUserType,
                }),
            ),
        ).toStrictEqual([
            { label: "Test Slack Connection", location: "subreddit", forUserType: "moderator" },
            { label: "Show Bot Status", location: "subreddit", forUserType: "moderator" },
            { label: "Show Team Stats", location: "subreddit", forUserType: "moderator" },
            { label: "Simulate Mod Action", location: "subreddit", forUserType: "moderator" },
            { label: "Setup Modqueue Monitoring", location: "subreddit", forUserType: "moderator" },
        ]);
    });
});
