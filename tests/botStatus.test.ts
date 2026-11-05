import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./support/app.js";
import type { App } from "./support/app.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const JOB_ID_KEY = "modqueue_monitor_job_id";

describe("the Show Bot Status menu item", (): void => {
    async function statusToast(app: Pick<App, "pressMenuItem" | "toasts">): Promise<string | undefined> {
        await app.pressMenuItem("Show Bot Status");

        expect(app.toasts[app.toasts.length - 1]?.appearance).toBe("neutral");

        return app.toasts[app.toasts.length - 1]?.text;
    }

    it("shows that the monitor is not scheduled yet", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await expect(statusToast(app)).resolves.toBe(
            "Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Not scheduled",
        );
    });

    it("shows the monitor’s schedule once it is set up", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.pressMenuItem("Setup Modqueue Monitoring");

        await expect(statusToast(app)).resolves.toBe(
            "Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Active (cron */15 * * * *)",
        );
    });

    it("shows an active one-off job without a schedule", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.seed(JOB_ID_KEY, "job-7");
        app.context.scheduler.jobs = [{ id: "job-7", name: "modqueueMonitor" }];

        await expect(statusToast(app)).resolves.toBe(
            "Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Active",
        );
    });

    it("flags a stored job the scheduler no longer has", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.seed(JOB_ID_KEY, "job-gone");

        await expect(statusToast(app)).resolves.toBe(
            "Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Stale reference",
        );
    });

    it("shows the monitor as unknown when the scheduler cannot list jobs", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.seed(JOB_ID_KEY, "job-1");
        app.context.scheduler.listJobs.mockRejectedValue(new Error("scheduler down"));

        await expect(statusToast(app)).resolves.toBe(
            "Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Unknown",
        );
    });

    it("shows the job status as unavailable when Redis fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.get.mockRejectedValue(new Error("redis down"));

        await expect(statusToast(app)).resolves.toBe(
            "Modqueue Monitoring: ON • Slack Webhook: Configured • Job Status: Unavailable",
        );
    });

    it("shows monitoring off and the webhook missing", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, {
            slackWebhookUrl: "",
            modqueueThreshold: 0,
            unmoderagedAgeHours: 0,
            reportedContentAgeHours: 0,
        });

        await expect(statusToast(app)).resolves.toBe(
            "Modqueue Monitoring: OFF • Slack Webhook: Missing • Modqueue Monitor: Not scheduled",
        );
    });
});
