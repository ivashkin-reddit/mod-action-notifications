import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { monitorJobs, monitorRuns } from "../fixtures/jobs.js";
import { keysBesidesConnection } from "../fixtures/redisKeys.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const JOB_ID_KEY = "modqueue_monitor_job_id";
const MONITOR_JOB = { id: "job-1", name: "modqueueMonitor", cron: "*/15 * * * *" };

describe("installing or upgrading the app", (): void => {
    it.each([["AppInstall"], ["AppUpgrade"]])(
        "%s schedules the modqueue monitor every 15 minutes, keeping nothing in Redis",
        TEST_OPTIONS,
        async (trigger): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire(trigger, { type: trigger });

            expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
            expect(keysBesidesConnection(app.context.redis)).toStrictEqual([]);
        },
    );

    it("keeps the job it already scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("AppInstall", { type: "AppInstall" });
        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(monitorRuns(app.context.scheduler.runJob.mock.calls)).toStrictEqual([
            { name: "modqueueMonitor", cron: "*/15 * * * *" },
        ]);
        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
    });

    it("schedules the monitor when only the age limit is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 12 });

        await app.fire("AppInstall", { type: "AppInstall" });

        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
    });

    it("cancels the job and forgets it when all monitor thresholds are 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("AppInstall", { type: "AppInstall" });
        app.settings.modqueueThreshold = 0;
        app.settings.unmoderagedAgeHours = 0;
        app.settings.reportedContentAgeHours = 0;
        app.settings.modmailWaitHours = 0;

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.cancelJob).toHaveBeenCalledWith("job-1");
        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([]);
        expect(keysBesidesConnection(app.context.redis)).toStrictEqual([]);
    });

    it("forgets the job even when cancelling it fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, {
            modqueueThreshold: 0,
            unmoderagedAgeHours: 0,
            reportedContentAgeHours: 0,
            modmailWaitHours: 0,
        });
        app.context.scheduler.jobs = [{ ...MONITOR_JOB, id: "job-gone" }];
        app.context.redis.seed(JOB_ID_KEY, "job-gone");
        app.context.scheduler.cancelJob.mockRejectedValue(new Error("no such job"));

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("job-gone");
        expect(keysBesidesConnection(app.context.redis)).toStrictEqual([]);
    });

    // Versions before this remembered the job's ID in Redis, which could name a job since cancelled. The scheduler
    // says what runs; setup deletes the old ID.
    it(
        "schedules the monitor whatever job ID an earlier version kept, and deletes it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.redis.seed(JOB_ID_KEY, "job-gone");

            await app.fire("AppUpgrade", { type: "AppUpgrade" });

            expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
            expect(keysBesidesConnection(app.context.redis)).toStrictEqual([]);
        },
    );

    it("still schedules the monitor when the old job ID cannot be deleted", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.del.mockRejectedValue(new Error("redis down"));

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
    });

    it("keeps one monitor job, cancelling extras left by overlapping setups", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.scheduler.jobs = [
            { ...MONITOR_JOB, id: "job-a" },
            { ...MONITOR_JOB, id: "job-b" },
        ];

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([{ ...MONITOR_JOB, id: "job-a" }]);
        expect(monitorRuns(app.context.scheduler.runJob.mock.calls)).toStrictEqual([]);
    });

    it("replaces a monitor job scheduled on another cron", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.scheduler.jobs = [{ ...MONITOR_JOB, id: "job-hourly", cron: "0 * * * *" }];

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
    });

    it("leaves scheduled jobs of other names alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, {
            modqueueThreshold: 0,
            unmoderagedAgeHours: 0,
            reportedContentAgeHours: 0,
            modmailWaitHours: 0,
        });
        app.context.scheduler.jobs = [{ id: "job-other", name: "otherJob", cron: "*/15 * * * *" }];

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.cancelJob).not.toHaveBeenCalled();
    });

    it("schedules nothing when all thresholds are 0 and no job exists", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, {
            modqueueThreshold: 0,
            unmoderagedAgeHours: 0,
            reportedContentAgeHours: 0,
            modmailWaitHours: 0,
        });

        await app.fire("AppInstall", { type: "AppInstall" });

        expect(monitorRuns(app.context.scheduler.runJob.mock.calls)).toStrictEqual([]);
        expect(app.context.scheduler.cancelJob).not.toHaveBeenCalled();
    });

    it.each([
        ["AppInstall", "[setup] Could not set up the modqueue monitor on install:"],
        ["AppUpgrade", "[setup] Could not set up the modqueue monitor on upgrade:"],
    ])("%s logs a scheduling failure and still succeeds", TEST_OPTIONS, async (trigger, logMessage): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const error = new Error("scheduler down");
        app.context.scheduler.runJob.mockRejectedValue(error);

        await app.fire(trigger, { type: trigger });

        expect(console.error).toHaveBeenCalledExactlyOnceWith(logMessage, error);
        expect(keysBesidesConnection(app.context.redis)).toStrictEqual([]);
    });
});

// Devvit can deliver a trigger twice at once, and a moderator can press Setup as the app installs: each setup can find
// no job and schedule one.
describe("setups that run at once", (): void => {
    it("leave one monitor job when AppUpgrade is delivered twice at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await Promise.all([
            app.fire("AppUpgrade", { type: "AppUpgrade" }),
            app.fire("AppUpgrade", { type: "AppUpgrade" }),
        ]);

        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
    });

    it("leave one monitor job when Setup is pressed as the app installs", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await Promise.all([
            app.fire("AppInstall", { type: "AppInstall" }),
            app.pressMenuItem("Setup Modqueue Monitoring"),
        ]);

        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
        expect(app.toasts).toStrictEqual([
            { text: "✅ Modqueue monitoring enabled (Job ID: job-1)", appearance: "success" },
        ]);
    });

    it("still report the job scheduled when listing jobs again fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("scheduler down");
        app.context.scheduler.listJobs.mockResolvedValueOnce([]).mockRejectedValueOnce(failure);

        await app.pressMenuItem("Setup Modqueue Monitoring");

        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
        expect(app.toasts).toStrictEqual([
            { text: "✅ Modqueue monitoring enabled (Job ID: job-1)", appearance: "success" },
        ]);
        expect(console.warn).toHaveBeenCalledWith(
            "[setup] Could not list the monitor jobs after scheduling one:",
            failure,
        );
    });
});
