import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import type { ModNotification } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const MINUTE = 60_000;
const DAY = 86_400_000;
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
            app.slack.respond(404, 404);

            await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
            await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

            expect(notices(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([
                {
                    subredditId: "t5_testsub",
                    subject: "Mod Action Bot: Slack is refusing alerts",
                    bodyMarkdown: [
                        "Slack is refusing alerts (HTTP 404: error), so they are dropped. Check the webhook URL in the app's settings, then use Test Slack Connection.",
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
        app.slack.respond(404);
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        expect(notices(app.context.reddit.modMail.createModNotification.mock.calls)[1]).toStrictEqual({
            subredditId: "t5_testsub",
            subject: "Mod Action Bot: resolved: Slack is refusing alerts",
            bodyMarkdown: "Slack is taking alerts again.",
        });
    });

    it("is sent again a day later while it lasts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(404);
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.advance(DAY);
        app.slack.respond(404);

        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        expect(subjects(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([
            "Mod Action Bot: Slack is refusing alerts",
            "Mod Action Bot: Slack is refusing alerts",
        ]);
    });

    it("is sent at most once a day, however often it comes and goes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(404);
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));
        app.slack.respond(404);

        await app.fire("ModAction", removedPost({ id: "ModAction_3" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_4" }));

        expect(subjects(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([
            "Mod Action Bot: Slack is refusing alerts",
            "Mod Action Bot: resolved: Slack is refusing alerts",
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
            "Mod Action Bot: Slack is not taking alerts",
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
            "Mod Action Bot: The modqueue monitor is failing",
        ]);
    });
});

describe("a missing webhook", (): void => {
    it("is not sent to modmail: moderators choose whether to set one", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: undefined });

        await app.fire("ModAction", removedPost());

        expect(notices(app.context.reddit.modMail.createModNotification.mock.calls)).toStrictEqual([]);
    });
});

describe("a notice modmail cannot take", (): void => {
    it("is logged, and the work it was about goes on", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("App user not found; did the app get banned?");
        app.context.reddit.modMail.createModNotification.mockRejectedValueOnce(failure);
        app.slack.respond(404);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        expect(console.warn).toHaveBeenCalledWith("[health] Could not send moderators a modmail notice:", {
            condition: "slack-refusing",
            error: failure,
        });
        expect(app.slack.messages).toHaveLength(2);
    });
});
