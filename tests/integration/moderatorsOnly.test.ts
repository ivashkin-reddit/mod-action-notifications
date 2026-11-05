import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { fakeUser } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const REFUSAL = { text: "🔒 Only this subreddit's moderators can use this.", appearance: "neutral" };
const MENU_ITEMS = [
    ["Test Slack Connection"],
    ["Show Bot Status"],
    ["Simulate Mod Action"],
    ["Setup Modqueue Monitoring"],
];

const SIMULATION = {
    actionType: ["removelink"],
    moderatorName: "SimMod",
    targetUser: "Victim",
    includeModNote: false,
    modNote: "",
    banDuration: 0,
    customDetails: "",
    slackChannel: "",
};

// Devvit shows a moderator menu item only to moderators, but runs its handler for whoever invokes it.
describe("a menu item", (): void => {
    it.each(MENU_ITEMS)(
        "%s is refused to a user who does not moderate the subreddit",
        TEST_OPTIONS,
        async (label: string): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.reddit.currentUser = fakeUser("Visitor", []);

            await app.pressMenuItem(label);

            expect(app.toasts).toStrictEqual([REFUSAL]);
            expect(app.context.ui.showForm).not.toHaveBeenCalled();
            expect(app.slack.requests).toStrictEqual([]);
            expect(app.context.scheduler.runJob).not.toHaveBeenCalled();
            expect(app.context.scheduler.cancelJob).not.toHaveBeenCalled();
        },
    );

    it.each(MENU_ITEMS)("%s is refused to a logged-out user", TEST_OPTIONS, async (label: string): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.currentUser = undefined;

        await app.pressMenuItem(label);

        expect(app.toasts).toStrictEqual([REFUSAL]);
        expect(app.context.ui.showForm).not.toHaveBeenCalled();
        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.scheduler.runJob).not.toHaveBeenCalled();
    });

    it(
        "is refused, and logged, when Reddit cannot say who the user moderates",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            const failure = new Error("reddit down");
            app.context.reddit.getCurrentUser.mockRejectedValue(failure);

            await app.pressMenuItem("Setup Modqueue Monitoring");

            expect(app.toasts).toStrictEqual([REFUSAL]);
            expect(app.context.scheduler.runJob).not.toHaveBeenCalled();
            expect(console.error).toHaveBeenCalledWith(
                "Failed to check that the user moderates the subreddit; refusing:",
                failure,
            );
        },
    );

    it("checks the user's permissions in this subreddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const moderator = fakeUser("ModA", ["posts"]);
        app.context.reddit.currentUser = moderator;

        await app.pressMenuItem("Show Bot Status");

        expect(moderator.getModPermissionsForSubreddit).toHaveBeenCalledExactlyOnceWith("testsub");
        expect(app.toasts[0]?.text).toMatch(/^Modqueue Monitoring: /u);
    });
});

// A form is submitted by the user it was shown to; one who has since stopped moderating is refused.
describe("a form", (): void => {
    it(
        "from Test Slack Connection sends nothing for a user who no longer moderates",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            await app.pressMenuItem("Test Slack Connection");
            app.context.reddit.currentUser = fakeUser("ModA", []);

            await app.submitForm(app.shownForm().key, {});

            expect(app.toasts).toStrictEqual([REFUSAL]);
            expect(app.slack.requests).toStrictEqual([]);
        },
    );

    it(
        "from Simulate Mod Action sends nothing for a user who no longer moderates",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            await app.pressMenuItem("Simulate Mod Action");
            app.context.reddit.currentUser = fakeUser("ModA", []);

            await app.submitForm(app.shownForm().key, SIMULATION);

            expect(app.toasts).toStrictEqual([REFUSAL]);
            expect(app.slack.requests).toStrictEqual([]);
        },
    );
});
