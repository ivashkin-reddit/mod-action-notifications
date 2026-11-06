import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { ScheduledJob } from "../fixtures/fakeScheduler.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const HOUR = 3_600_000;
const DAY_SECONDS = 86_400;
/** From NOW, 12:00 UTC on 4 November, to 08:00 UTC the next day, when the summary job runs. */
const TO_NEXT_MORNING = 20 * HOUR;
const SUMMARY_JOB = { name: "dailySummary", cron: "0 8 * * *" };

function summaryJobs(jobs: readonly ScheduledJob[]): readonly Readonly<{ name: string; cron: string | undefined }>[] {
    return jobs
        .filter((job: ScheduledJob): boolean => job.name === "dailySummary")
        .map(({ name, cron }: ScheduledJob): Readonly<{ name: string; cron: string | undefined }> => ({ name, cron }));
}

describe("the daily summary job", (): void => {
    it.each([["AppInstall"], ["AppUpgrade"]])(
        "is scheduled for 08:00 UTC each day by %s, once however often setup runs",
        TEST_OPTIONS,
        async (trigger: string): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire(trigger, { type: trigger });
            await app.fire(trigger, { type: trigger });

            expect(summaryJobs(app.context.scheduler.jobs)).toStrictEqual([SUMMARY_JOB]);
        },
    );

    // Setups that run at once list the same jobs, so each keeps the same one.
    it(
        "keeps the summary job with the lowest ID of two left by overlapping setups",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.scheduler.jobs = [
                { id: "job-b", ...SUMMARY_JOB },
                { id: "job-a", ...SUMMARY_JOB },
            ];

            await app.fire("AppUpgrade", { type: "AppUpgrade" });

            expect(
                app.context.scheduler.jobs
                    .filter((job: ScheduledJob): boolean => job.name === "dailySummary")
                    .map((job: ScheduledJob): string => job.id),
            ).toStrictEqual(["job-a"]);
        },
    );

    it("replaces a summary job on another schedule", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.scheduler.jobs = [{ id: "job-old", name: "dailySummary", cron: "0 6 * * *" }];

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(summaryJobs(app.context.scheduler.jobs)).toStrictEqual([SUMMARY_JOB]);
    });
});

describe("the daily summary", (): void => {
    it("is off by default: the job sends nothing", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.runJob("dailySummary");

        expect(app.slack.requests).toStrictEqual([]);
    });

    it(
        "sends yesterday's counts, and the problems now, to the notification channel",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { dailySummary: true, notificationChannel: "mod-log" });
            await app.fire("ModAction", removedPost());
            await app.advance(TO_NEXT_MORNING);

            await app.runJob("dailySummary");

            expect(app.slack.messages.slice(-1)).toStrictEqual([
                {
                    text: "📊 Daily summary for 2026-11-04 (UTC)",
                    username: "Mod Action Notifications",
                    icon_emoji: ":bar_chart:",
                    channel: "#mod-log",
                    attachments: [
                        {
                            color: "#0088ff",
                            text: [
                                "• *Mod actions:* 1",
                                "• *Alerts:* 1 delivered, 0 dropped, 0 redacted",
                                "• *Modqueue monitor:* 0 runs, 0 failed",
                                "• *Problems now:* None",
                            ].join("\n"),
                            mrkdwn_in: ["text"],
                            footer: "Mod Action Notifications - Daily Summary",
                            ts: Math.floor((NOW.getTime() + TO_NEXT_MORNING) / 1000),
                        },
                    ],
                },
            ]);
        },
    );

    it("names each problem in force", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { dailySummary: true });
        app.context.reddit.modQueueAll.mockRejectedValue(new Error("reddit 503"));
        await app.runJob("modqueueMonitor");
        await app.advance(TO_NEXT_MORNING);

        await app.runJob("dailySummary");

        expect(app.slack.messages.slice(-1)[0]?.attachments?.[0]?.text).toContain(
            "• *Problems now:* The modqueue monitor is failing",
        );
    });

    it("is sent on a later run when a run cannot read the day's counts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { dailySummary: true });
        app.context.redis.hGetAll.mockRejectedValueOnce(new Error("redis down"));

        await app.runJob("dailySummary");
        await app.runJob("dailySummary");

        expect(app.slack.requests).toHaveLength(1);
    });

    it("is sent once a day, however often the job runs", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { dailySummary: true });

        await app.runJob("dailySummary");
        await app.runJob("dailySummary");

        expect(app.slack.requests).toHaveLength(1);
        expect(app.context.redis.ttlSeconds("health:summary:2026-11-03")).toBe(2 * DAY_SECONDS);
    });

    it("sends nothing while no bot token is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { dailySummary: true, slackBotToken: undefined });

        await app.runJob("dailySummary");

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.redis.keys()).not.toContain("health:summary:2026-11-03");
    });
});
