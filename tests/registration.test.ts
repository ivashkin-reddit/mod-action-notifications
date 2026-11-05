import { describe, expect, it, vi } from "vitest";
import devvitJson from "../devvit.json" with { type: "json" };
import { loadApp } from "./support/app.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
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
                { name: "slackWebhookUrl", type: "string", defaultValue: undefined },
                {
                    name: "enabledActions",
                    type: "select",
                    defaultValue: ["removelink", "removecomment", "spamlink", "spamcomment", "banuser", "unbanuser"],
                },
                { name: "excludedModerators", type: "string", defaultValue: undefined },
                { name: "flagUnknownModerators", type: "boolean", defaultValue: true },
                { name: "includeModNote", type: "boolean", defaultValue: true },
                { name: "notificationChannel", type: "string", defaultValue: undefined },
                { name: "alertChannel", type: "string", defaultValue: undefined },
                { name: "modqueueThreshold", type: "number", defaultValue: 50 },
                { name: "unmoderagedAgeHours", type: "number", defaultValue: 24 },
                { name: "reportedContentAgeHours", type: "number", defaultValue: 24 },
                { name: "enableAutoModAlerts", type: "boolean", defaultValue: false },
                { name: "postDeletionUpvoteThreshold", type: "number", defaultValue: 100 },
            ]);
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
        expect(registered).toStrictEqual(["onAppInstall", "onAppUpgrade", "onModAction", "onPostDelete"]);
    });

    // Devvit 0.15 grants a Blocks app only the permissions devvit.json declares, whatever Devvit.configure says.
    it("is granted in devvit.json what it asks for in Devvit.configure", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const { permissions, blocks } = devvitJson;

        expect(app.registrations.configure).toStrictEqual([
            { redditAPI: true, http: { domains: ["hooks.slack.com"] }, redis: true },
        ]);
        expect(permissions).toStrictEqual({
            http: { enable: true, domains: ["hooks.slack.com"] },
            redis: true,
            reddit: true,
        });
        expect(blocks.entry).toBe("src/main.ts");
    });

    // Scheduler job names are stored with every scheduled job: renaming one orphans the jobs already scheduled.
    it(
        "registers the modqueue monitor and the Slack outbox as its scheduler jobs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            expect(Object.keys(app.registrations.schedulerJobs)).toStrictEqual(["modqueueMonitor", "slackOutbox"]);
        },
    );

    it("adds four subreddit menu items, shown to moderators only", TEST_OPTIONS, async (): Promise<void> => {
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
            { label: "Simulate Mod Action", location: "subreddit", forUserType: "moderator" },
            { label: "Setup Modqueue Monitoring", location: "subreddit", forUserType: "moderator" },
        ]);
    });
});
