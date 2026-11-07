import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import { commentDeleteEvent, removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const JOB_ID_KEY = "modqueue_monitor_job_id";
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY_SECONDS = 86_400;

/** Presses Show Bot Status, and returns what the form it shows says, by label. */
async function status(
    app: Readonly<Pick<App, "pressMenuItem" | "shownForm">>,
): Promise<Readonly<Record<string, unknown>>> {
    await app.pressMenuItem("Show Bot Status");
    const { fields } = app.shownForm().definition;

    expect(fields.every((field): boolean => field.disabled === true)).toBe(true);

    return Object.fromEntries(
        fields.map((field): readonly [string, unknown] => [field.label ?? field.name, field.defaultValue]),
    );
}

describe("the Show Bot Status menu item", (): void => {
    it("shows the app version, and that Slack is set up", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await expect(status(app)).resolves.toMatchObject({
            "App version": "1.2.3",
            "Slack app": "Connected to Test Workspace",
        });
    });

    it("shows that the monitor is not scheduled yet", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await expect(status(app)).resolves.toMatchObject({
            "Modqueue monitor": "On, but not scheduled. Use Setup Modqueue Monitoring.",
        });
    });

    it("shows the monitor’s schedule once it is set up", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.pressMenuItem("Setup Modqueue Monitoring");

        await expect(status(app)).resolves.toMatchObject({ "Modqueue monitor": "On, scheduled (cron */15 * * * *)" });
    });

    it("shows an active one-off job without a schedule", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.scheduler.jobs = [{ id: "job-7", name: "modqueueMonitor" }];

        await expect(status(app)).resolves.toMatchObject({ "Modqueue monitor": "On, with a one-off run scheduled" });
    });

    // Versions before this remembered the job's ID in Redis, which could outlive the job, or be missing while one ran.
    it(
        "takes the monitor's state from the scheduler, not a job ID an earlier version kept",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.redis.seed(JOB_ID_KEY, "job-gone");

            await expect(status(app)).resolves.toMatchObject({
                "Modqueue monitor": "On, but not scheduled. Use Setup Modqueue Monitoring.",
            });
        },
    );

    it("shows the monitor as unknown when the scheduler cannot list jobs", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.scheduler.listJobs.mockRejectedValue(new Error("scheduler down"));

        await expect(status(app)).resolves.toMatchObject({
            "Modqueue monitor": "Unknown: the scheduler could not be read",
        });
    });

    it("shows the monitor's schedule while Redis is down", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.pressMenuItem("Setup Modqueue Monitoring");
        app.context.redis.get.mockRejectedValue(new Error("redis down"));

        await expect(status(app)).resolves.toMatchObject({
            "Modqueue monitor": "On, scheduled (cron */15 * * * *)",
            "Slack app": "Unknown: Redis could not be read",
        });
    });

    it("shows monitoring off and the bot token missing", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, {
            connectedToken: "",
            modqueueThreshold: 0,
            unmoderagedAgeHours: 0,
            reportedContentAgeHours: 0,
            modmailWaitHours: 0,
        });

        await expect(status(app)).resolves.toMatchObject({
            "Slack app": "Not connected, so no alerts are sent. Use Connect Slack",
            "Modqueue monitor": "Off: all its thresholds are 0",
        });
    });

    it("shows the notification channel missing", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { notificationChannel: "" });

        await expect(status(app)).resolves.toMatchObject({
            "Slack app": "No Notification Channel is set, so no alerts are sent",
        });
    });
});

describe("the problems Show Bot Status shows", (): void => {
    it("are none on a working app", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await expect(status(app)).resolves.toMatchObject({ "Current problems": "None", "Alerts waiting": "None" });
    });

    it("include each one in force, with what the app saw and for how long", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond("not_in_channel");
        await app.fire("ModAction", removedPost());
        await app.advance(3 * HOUR);

        await expect(status(app)).resolves.toMatchObject({
            "Current problems":
                "For 3 hours: Slack is refusing alerts (not_in_channel), so they are dropped. Check that the channels in the app's settings are right and the Slack app has been added to them, then use Test Slack Connection. invalid_auth or token_revoked means Slack needs connecting again, with Connect Slack and a new token.",
        });
    });

    it(
        "include alerts waiting for Slack, and how long the oldest has waited",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(503, 503, 503, 503);
            await app.fire("ModAction", removedPost());
            await app.advance(2 * HOUR);

            await expect(status(app)).resolves.toMatchObject({ "Alerts waiting": "1, the oldest for 2 hours" });
        },
    );

    // Another version of the app may have kept a condition this one does not know.
    it("leave out a problem this version does not know", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.context.redis.hSetNX(
            "health:conditions",
            "retired-condition",
            JSON.stringify({ since: 0, detail: "" }),
        );

        await expect(status(app)).resolves.toMatchObject({ "Current problems": "None" });
    });

    it("say so when Redis cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.hGetAll.mockRejectedValue(new Error("redis down"));
        app.context.redis.zCard.mockRejectedValue(new Error("redis down"));

        await expect(status(app)).resolves.toMatchObject({
            "Current problems": "Unknown: Redis could not be read",
            "Alerts waiting": "Unknown: Redis could not be read",
        });
    });
});

// Moderators cannot read the app's logs: these tell them it is at work.
describe("what Show Bot Status says the app has done", (): void => {
    it("is nothing yet on a new install", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await expect(status(app)).resolves.toMatchObject({
            "Last alert delivered": "None in the last week",
            "Last monitor run": "None in the last week",
            "Last events":
                "Mod action: none in the last week\nPost deleted: none in the last week\nComment deleted: none in the last week",
            "Today (UTC)": "0 mod actions; 0 alerts delivered, 0 dropped, 0 redacted; 0 monitor runs, 0 failed",
        });
    });

    it("includes when an alert last reached Slack", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("ModAction", removedPost());
        await app.advance(3 * MINUTE);

        await expect(status(app)).resolves.toMatchObject({ "Last alert delivered": "3 minutes ago" });
    });

    it("includes when each trigger last fired", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("ModAction", removedPost());
        await app.advance(HOUR);
        await app.fire("CommentDelete", commentDeleteEvent({ commentId: "t1_c", postId: "t3_p" }));

        await expect(status(app)).resolves.toMatchObject({
            "Last events":
                "Mod action: 1 hour ago\nPost deleted: none in the last week\nComment deleted: less than a minute ago",
        });
    });

    it("includes the modqueue monitor's last run, and whether it failed", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.runJob("modqueueMonitor");
        await app.advance(5 * MINUTE);
        const afterSuccess = await status(app);
        app.context.reddit.modQueueAll.mockRejectedValue(new Error("reddit 503"));
        await app.runJob("modqueueMonitor");

        expect(afterSuccess).toMatchObject({ "Last monitor run": "5 minutes ago, succeeded" });
        await expect(status(app)).resolves.toMatchObject({ "Last monitor run": "less than a minute ago, failed" });
    });

    it("counts today's mod actions, alerts and monitor runs", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        app.slack.respond(404);
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));
        await app.runJob("modqueueMonitor");

        await expect(status(app)).resolves.toMatchObject({
            "Today (UTC)": "2 mod actions; 1 alert delivered, 1 dropped, 0 redacted; 1 monitor run, 0 failed",
        });
    });

    // Stored data: renaming these keys would lose what installations hold.
    it(
        "keeps when each last happened for a week, and each day's counts for eight days",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire("ModAction", removedPost());

            await expect(app.context.redis.hGetAll("health:last")).resolves.toStrictEqual({
                "mod-action": String(NOW.getTime()),
                "alert-delivered": String(NOW.getTime()),
            });
            await expect(app.context.redis.hGetAll("health:count:2026-11-04")).resolves.toStrictEqual({
                "mod-action": "1",
                "alert-delivered": "1",
            });
            expect(app.context.redis.ttlSeconds("health:last")).toBe(7 * DAY_SECONDS);
            expect(app.context.redis.ttlSeconds("health:count:2026-11-04")).toBe(8 * DAY_SECONDS);
        },
    );
});
