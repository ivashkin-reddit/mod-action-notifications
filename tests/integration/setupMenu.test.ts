import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { monitorJobs } from "../fixtures/jobs.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const MONITOR_JOB = { id: "job-1", name: "modqueueMonitor", cron: "*/15 * * * *" };

describe("the Setup Modqueue Monitoring menu item", (): void => {
    it("schedules the monitor and shows its job ID", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.pressMenuItem("Setup Modqueue Monitoring");

        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([MONITOR_JOB]);
        expect(app.toasts).toStrictEqual([
            { text: "✅ Modqueue monitoring enabled (Job ID: job-1)", appearance: "success" },
        ]);
    });

    it("shows the existing job when pressed again", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.pressMenuItem("Setup Modqueue Monitoring");
        await app.pressMenuItem("Setup Modqueue Monitoring");

        expect(monitorJobs(app.context.scheduler.jobs)).toHaveLength(1);
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
        expect(console.error).toHaveBeenCalledWith("[setup] Could not set up the modqueue monitor:", error);
    });
});
