import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import { createFakeContext, defaultSettings } from "../fixtures/fakeContext.js";
import type { ModNotification, Settings } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const MINUTE = 60_000;
const DAY_SECONDS = 86_400;
const DAY = DAY_SECONDS * 1000;
/** Slack failing every attempt one drain makes at an alert, so the alert waits in the queue. */
const SLACK_DOWN = [503, 503, 503, 503] as const;

/** What reddit.modMail.createModNotification was called with: each call's notification. */
type Sent = readonly (readonly [ModNotification])[];

/** The modmail notifications the app sent, oldest first. */
function notices(sent: Sent): readonly ModNotification[] {
    return sent.map(([notification]: readonly [ModNotification]): ModNotification => notification);
}

function subjects(sent: Sent): readonly string[] {
    return notices(sent).map((notice: ModNotification): string => notice.subject);
}

// Slack may be the very thing that is broken, so a problem moderators must act on goes to modmail too.
describe("a problem moderators must act on", (): void => {
    it(
        "is sent to the subreddit's modmail once, however many alerts it affects",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond("not_in_channel", "not_in_channel");

            await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
            await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

            expect(notices(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([
                {
                    subredditId: "t5_testsub",
                    subject: "Mod Action Notifications: Slack is refusing alerts",
                    bodyMarkdown: [
                        "Slack is refusing alerts (not_in_channel), so they are dropped. Check that the channels in the app's settings are right and the Slack app has been added to them, then use Test Slack Connection. invalid_auth or token_revoked means the bot token needs replacing.",
                        "This started at 2026-11-04 12:00 UTC. **Show Bot Status**, in the subreddit's mod tools, shows how the bot is doing now.",
                        "_The bot sends this at most once a day for each problem, and says when it is over._",
                    ].join("\n\n"),
                },
            ]);
        },
    );

    it("is followed by a notice once it is over", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond("not_in_channel");
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        expect(notices(app.context.reddit.modMail.createModNotification.mock.calls)[1]).toStrictEqual({
            subredditId: "t5_testsub",
            subject: "Mod Action Notifications: resolved: Slack is refusing alerts",
            bodyMarkdown: "Slack is taking alerts again.",
        });
    });

    it("is sent again a day later while it lasts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond("not_in_channel");
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.advance(DAY);
        app.slack.respond("not_in_channel");

        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        expect(subjects(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([
            "Mod Action Notifications: Slack is refusing alerts",
            "Mod Action Notifications: Slack is refusing alerts",
        ]);
    });

    it("is sent at most once a day, however often it comes and goes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond("not_in_channel");
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));
        app.slack.respond("not_in_channel");

        await app.fire("ModAction", removedPost({ id: "ModAction_3" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_4" }));

        expect(subjects(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([
            "Mod Action Notifications: Slack is refusing alerts",
            "Mod Action Notifications: resolved: Slack is refusing alerts",
        ]);
    });
});

// A Slack outage or a Reddit error often passes within minutes; a notice for each would only be noise.
describe("a problem that may pass by itself", (): void => {
    it("is sent once Slack has not taken alerts for 30 minutes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(...SLACK_DOWN, ...SLACK_DOWN);
        await app.fire("ModAction", removedPost());
        const atFirst = subjects(app.context.reddit.modMail.createModNotification.mock.calls);
        await app.advance(30 * MINUTE);

        await app.runJob("slackOutbox");

        expect(atFirst).toStrictEqual([]);
        expect(subjects(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([
            "Mod Action Notifications: Slack is not taking alerts",
        ]);
    });

    it("is sent once the modqueue monitor has failed for 30 minutes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modQueueAll.mockRejectedValue(new Error("reddit 503"));
        await app.runJob("modqueueMonitor");
        await app.advance(15 * MINUTE);
        await app.runJob("modqueueMonitor");
        const atFifteenMinutes = subjects(app.context.reddit.modMail.createModNotification.mock.calls);
        await app.advance(15 * MINUTE);

        await app.runJob("modqueueMonitor");

        expect(atFifteenMinutes).toStrictEqual([]);
        expect(subjects(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([
            "Mod Action Notifications: The modqueue monitor is failing",
        ]);
    });
});

describe("a Slack app not set up", (): void => {
    it.each([
        ["no bot token", { slackBotToken: undefined }],
        ["no notification channel", { notificationChannel: undefined }],
    ])(
        "is not sent to modmail for %s: it is set up with the app",
        TEST_OPTIONS,
        async (_label: string, settings: Readonly<Settings>): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, settings);

            await app.fire("ModAction", removedPost());

            expect(notices(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([]);
        },
    );
});

// Stored data: renaming these keys would lose what installations hold.
describe("the notices sent", (): void => {
    it(
        "are claimed for a day each, and kept for a week so their end is sent",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond("not_in_channel");

            await app.fire("ModAction", removedPost());

            await expect(app.context.redis.hGetAll("health:noticed")).resolves.toStrictEqual({
                "slack-refusing": String(NOW.getTime()),
            });
            expect(app.context.redis.ttlSeconds("health:noticed")).toBe(7 * DAY_SECONDS);
            expect(app.context.redis.ttlSeconds("health:notice:slack-refusing")).toBe(DAY_SECONDS);
        },
    );
});

describe("a notice modmail cannot take", (): void => {
    it(
        "is not sent for an installation Devvit names by something other than a subreddit ID",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            const { context: installation } = createFakeContext(defaultSettings(), "not-a-subreddit");
            app.slack.respond("not_in_channel");

            await app.fire("ModAction", removedPost(), installation);

            expect(installation.reddit.modMail.createModNotification).not.toHaveBeenCalled();
            expect(console.warn).toHaveBeenCalledWith("[health] Could not send moderators a modmail notice:", {
                condition: "slack-refusing",
                error: new Error("Not a subreddit ID: not-a-subreddit"),
            });
        },
    );

    it("is logged, and the work it was about goes on", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("App user not found; did the app get banned?");
        app.context.reddit.modMail.createModNotification.mockRejectedValueOnce(failure);
        app.slack.respond("not_in_channel");

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        expect(console.warn).toHaveBeenCalledWith("[health] Could not send moderators a modmail notice:", {
            condition: "slack-refusing",
            error: failure,
        });
        expect(app.slack.messages).toHaveLength(2);
    });
});
