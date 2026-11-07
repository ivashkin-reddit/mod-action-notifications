import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
/** From NOW, Wednesday 4 November 12:00 UTC, to Monday 9 November 08:00 UTC. */
const TO_MONDAY_MORNING = (4 * 24 + 20) * 3_600_000;

// Devvit keeps nothing an app can read about a scheduler run that rejects: a job logs its own failure.
describe("a scheduled job that fails", (): void => {
    it("logs it when the outbox cannot be read, and resolves", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("redis down");
        app.context.redis.zRange.mockRejectedValueOnce(failure);

        await expect(app.runJob("slackOutbox")).resolves.toBeUndefined();
        expect(console.error).toHaveBeenCalledWith(
            "[outbox] Could not deliver the queued alerts; they wait for the next drain:",
            failure,
        );
    });

    it(
        "sends the weekly statistics on a later run when a run cannot read them",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { weeklyStatistics: true });
            await app.advance(TO_MONDAY_MORNING);
            app.context.redis.zRange.mockRejectedValueOnce(new Error("redis down"));

            await app.runJob("weeklyStatistics");
            await app.runJob("weeklyStatistics");

            expect(app.slack.messages.map((message): string => message.text.slice(0, 18))).toStrictEqual([
                "📊 Team statistics",
            ]);
        },
    );
});

describe("setting up the scheduled jobs", (): void => {
    it(
        "schedules the daily summary and the weekly statistics when the monitor cannot be set up",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.scheduler.listJobs.mockRejectedValueOnce(new Error("scheduler down"));

            await app.fire("AppInstall", { type: "AppInstall" });

            expect(
                app.context.scheduler.jobs
                    .map(({ name }): string => name)
                    .sort((first: string, second: string): number => first.localeCompare(second)),
            ).toStrictEqual(["dailySummary", "weeklyStatistics"]);
        },
    );
});

describe("the Show Team Stats menu item", (): void => {
    it("says so when the statistics cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("redis down");
        app.context.redis.zRange.mockRejectedValueOnce(failure);

        await app.pressMenuItem("Show Team Stats");

        expect(app.toasts).toStrictEqual([
            { text: "❌ Could not read the team's statistics. Try again in a moment.", appearance: "neutral" },
        ]);
        expect(console.warn).toHaveBeenCalledWith("[menu] Could not read the team's statistics:", failure);
    });
});
