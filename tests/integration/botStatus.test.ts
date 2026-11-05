import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const JOB_ID_KEY = "modqueue_monitor_job_id";

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
    it("shows the app version, and that the webhook is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await expect(status(app)).resolves.toMatchObject({ "App version": "1.2.3", "Slack webhook": "Set" });
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

        await expect(status(app)).resolves.toMatchObject({ "Modqueue monitor": "On, scheduled (cron */15 * * * *)" });
    });

    it("shows monitoring off and the webhook missing", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, {
            slackWebhookUrl: "",
            modqueueThreshold: 0,
            unmoderagedAgeHours: 0,
            reportedContentAgeHours: 0,
        });

        await expect(status(app)).resolves.toMatchObject({
            "Slack webhook": "Not set, so no alerts are sent",
            "Modqueue monitor": "Off: all its thresholds are 0",
        });
    });

    it("shows a webhook URL that is not a Slack one", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: "https://example.com/hook" });

        await expect(status(app)).resolves.toMatchObject({
            "Slack webhook": "Not a Slack webhook URL, so no alerts are sent",
        });
    });
});
