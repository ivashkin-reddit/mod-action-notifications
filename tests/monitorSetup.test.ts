import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./support/app.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const JOB_ID_KEY = "modqueue_monitor_job_id";
const MONITOR_JOB = { id: "job-1", name: "modqueueMonitor", cron: "*/15 * * * *" };

describe("installing or upgrading the app", (): void => {
    it.each([["AppInstall"], ["AppUpgrade"]])(
        "%s schedules the modqueue monitor every 15 minutes",
        TEST_OPTIONS,
        async (trigger): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire(trigger, { type: trigger });

            expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
            await expect(app.context.redis.get(JOB_ID_KEY)).resolves.toBe("job-1");
            expect(app.context.redis.ttlSeconds(JOB_ID_KEY)).toBeUndefined();
        },
    );

    it("keeps the job it already scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("AppInstall", { type: "AppInstall" });
        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.runJob).toHaveBeenCalledExactlyOnceWith({
            name: "modqueueMonitor",
            cron: "*/15 * * * *",
        });
        expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
    });

    it("schedules the monitor when only the age limit is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 12 });

        await app.fire("AppInstall", { type: "AppInstall" });

        expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
    });

    it("cancels the job and forgets it when all monitor thresholds are 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("AppInstall", { type: "AppInstall" });
        app.settings.modqueueThreshold = 0;
        app.settings.unmoderagedAgeHours = 0;
        app.settings.reportedContentAgeHours = 0;

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.cancelJob).toHaveBeenCalledWith("job-1");
        expect(app.context.scheduler.jobs).toStrictEqual([]);
        expect(app.context.redis.keys()).toStrictEqual([]);
    });

    it("forgets the job even when cancelling it fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0, reportedContentAgeHours: 0 });
        app.context.scheduler.jobs = [{ ...MONITOR_JOB, id: "job-gone" }];
        app.context.redis.seed(JOB_ID_KEY, "job-gone");
        app.context.scheduler.cancelJob.mockRejectedValue(new Error("no such job"));

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("job-gone");
        expect(app.context.redis.keys()).toStrictEqual([]);
    });

    // The scheduler, not the remembered ID, says what runs: the remembered job may have been cancelled, or a setup
    // interrupted between scheduling a job and remembering it.
    it("replaces a remembered job that is no longer scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.seed(JOB_ID_KEY, "job-gone");

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
        await expect(app.context.redis.get(JOB_ID_KEY)).resolves.toBe("job-1");
    });

    it("keeps one monitor job, cancelling extras left by overlapping setups", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.scheduler.jobs = [
            { ...MONITOR_JOB, id: "job-a" },
            { ...MONITOR_JOB, id: "job-b" },
        ];

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.jobs).toStrictEqual([{ ...MONITOR_JOB, id: "job-a" }]);
        expect(app.context.scheduler.runJob).not.toHaveBeenCalled();
        await expect(app.context.redis.get(JOB_ID_KEY)).resolves.toBe("job-a");
    });

    it("replaces a monitor job scheduled on another cron", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.scheduler.jobs = [{ ...MONITOR_JOB, id: "job-hourly", cron: "0 * * * *" }];

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
    });

    it("leaves scheduled jobs of other names alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0, reportedContentAgeHours: 0 });
        app.context.scheduler.jobs = [{ id: "job-other", name: "otherJob", cron: "*/15 * * * *" }];

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(app.context.scheduler.cancelJob).not.toHaveBeenCalled();
    });

    it("schedules nothing when all thresholds are 0 and no job exists", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0, reportedContentAgeHours: 0 });

        await app.fire("AppInstall", { type: "AppInstall" });

        expect(app.context.scheduler.runJob).not.toHaveBeenCalled();
        expect(app.context.scheduler.cancelJob).not.toHaveBeenCalled();
    });

    it.each([
        ["AppInstall", "Failed to auto-setup modqueue monitoring on install:"],
        ["AppUpgrade", "Failed to setup modqueue monitoring on upgrade:"],
    ])("%s logs a scheduling failure and still succeeds", TEST_OPTIONS, async (trigger, logMessage): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const error = new Error("scheduler down");
        app.context.scheduler.runJob.mockRejectedValue(error);

        await app.fire(trigger, { type: trigger });

        expect(console.error).toHaveBeenCalledWith("Failed to schedule modqueue monitor job", error);
        expect(console.error).toHaveBeenCalledWith(logMessage, error);
        expect(app.context.redis.keys()).toStrictEqual([]);
    });
});

describe("the Setup Modqueue Monitoring menu item", (): void => {
    it("schedules the monitor and shows its job ID", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.pressMenuItem("Setup Modqueue Monitoring");

        expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
        expect(app.toasts).toStrictEqual([
            { text: "✅ Modqueue monitoring enabled (Job ID: job-1)", appearance: "success" },
        ]);
    });

    it("shows the existing job when pressed again", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.pressMenuItem("Setup Modqueue Monitoring");
        await app.pressMenuItem("Setup Modqueue Monitoring");

        expect(app.context.scheduler.jobs).toHaveLength(1);
        expect(app.toasts.map((toast): string => toast.text)).toStrictEqual([
            "✅ Modqueue monitoring enabled (Job ID: job-1)",
            "✅ Modqueue monitoring enabled (Job ID: job-1)",
        ]);
    });

    it("shows an unknown job ID when the scheduler returns none", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.scheduler.runJob.mockResolvedValue("");

        await app.pressMenuItem("Setup Modqueue Monitoring");

        expect(app.toasts[0]?.text).toBe("✅ Modqueue monitoring enabled (Job ID: unknown)");
    });

    it("reports monitoring as disabled when all thresholds are 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0, reportedContentAgeHours: 0 });

        await app.pressMenuItem("Setup Modqueue Monitoring");

        expect(app.toasts).toStrictEqual([
            { text: "⚠️ Modqueue monitoring disabled (thresholds set to 0)", appearance: "neutral" },
        ]);
    });

    it("reports a scheduling failure", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const error = new Error("scheduler down");
        app.context.scheduler.runJob.mockRejectedValue(error);

        await app.pressMenuItem("Setup Modqueue Monitoring");

        expect(app.toasts).toStrictEqual([{ text: "❌ Failed to setup modqueue monitoring", appearance: "neutral" }]);
        expect(console.error).toHaveBeenCalledWith("Failed to setup modqueue monitoring:", error);
    });
});
