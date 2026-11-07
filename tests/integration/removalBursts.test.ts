import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { ScheduledJob } from "../fixtures/fakeScheduler.js";
import type { SlackMessage } from "../fixtures/fakeSlack.js";
import { lines } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 20_000 };
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const BURST_JOB = "removalBurst";
const NOTIFICATIONS = "#mod-log";
const BURST_LINE = "• *Burst:* Further removals by <https://www.reddit.com/u/ModA|u/ModA> will be summarised";

/** A run of removals: how many, how far apart, by whom (ModA unless named), and the first one's index in the test. */
type Run = Readonly<{ count: number; gap: number; moderator?: string; from?: number }>;

/** The run's removals, each its own action; the summaries due between them run first. */
async function removals(
    app: Readonly<Pick<App, "advance" | "fire" | "runDueJobs">>,
    { count, gap, moderator = "ModA", from = 0 }: Run,
): Promise<void> {
    for (let index = from; index < from + count; index += 1) {
        await app.runDueJobs(BURST_JOB);
        await app.fire("ModAction", removedPost({ id: `ModAction_${String(index)}`, moderator: { name: moderator } }));
        await app.advance(gap);
    }
}

function texts(messages: readonly SlackMessage[]): readonly string[] {
    return messages.map((message: SlackMessage): string => message.text);
}

function burstJobs(jobs: readonly ScheduledJob[]): readonly ScheduledJob[] {
    return jobs.filter((job: ScheduledJob): boolean => job.name === BURST_JOB);
}

describe("a moderator's burst of removals", (): void => {
    it(
        "is alerted one by one up to the fifth in a minute, then summarised a minute after the last",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { notificationChannel: "mod-log" });

            await removals(app, { count: 20, gap: SECOND });

            expect(app.slack.messages).toHaveLength(5);
            expect(lines(app.slack.messages[4]).slice(-2)).toStrictEqual([
                "• *Status:* Activity spike 5 actions / 1 min",
                BURST_LINE,
            ]);

            await app.advance(MINUTE);
            await app.runDueJobs(BURST_JOB);

            // The burst opened at the fifth removal: its summary counts that one and the 15 after it.
            const [summary] = app.slack.messages.slice(5);

            expect([summary?.channel, summary?.text]).toStrictEqual([
                NOTIFICATIONS,
                "🧹 Removal burst: 16 posts removed",
            ]);
            expect(lines(summary)).toStrictEqual([
                "🧹 *Removal Burst*",
                "• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>",
                "• *Removed:* 16 posts",
                "• *When:* 2026-11-04 12:00:04 UTC to 2026-11-04 12:00:19 UTC",
                "• *Mod log:* <https://old.reddit.com/r/testsub/about/log/?mod=ModA|Open the mod log>",
            ]);
            expect(app.slack.messages).toHaveLength(6);
        },
    );

    it("sends running totals every five minutes while it lasts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        // A removal every 10 seconds for 12 minutes; the fifth, at 40 seconds, opens the burst.
        await removals(app, { count: 72, gap: 10 * SECOND });
        await app.advance(MINUTE);
        await app.runDueJobs(BURST_JOB);

        expect(texts(app.slack.messages).slice(5)).toStrictEqual([
            "🧹 Removal burst, still going: 30 posts removed so far",
            "🧹 Removal burst, still going: 60 posts removed so far",
            "🧹 Removal burst: 68 posts removed",
        ]);
    });

    it("is summarised once when the scheduler delivers its job twice", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await removals(app, { count: 8, gap: SECOND });
        // The scheduler delivers the summary's job twice.
        app.context.scheduler.jobs = [
            ...app.context.scheduler.jobs,
            ...burstJobs(app.context.scheduler.jobs).map((job: ScheduledJob): ScheduledJob => ({
                ...job,
                id: "again",
            })),
        ];

        await app.advance(2 * MINUTE);
        await app.runDueJobs(BURST_JOB);

        expect(texts(app.slack.messages).filter((text: string): boolean => text.startsWith("🧹"))).toStrictEqual([
            "🧹 Removal burst: 4 posts removed",
        ]);
    });

    it(
        "is summarised still when its job is lost, rescued by a later removal",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            await removals(app, { count: 5, gap: SECOND });
            // The scheduler loses the summary's run.
            app.context.scheduler.jobs = app.context.scheduler.jobs.filter(
                (job: ScheduledJob): boolean => job.name !== BURST_JOB,
            );

            // Removals go on past when the summary was due, and a minute more.
            await removals(app, { count: 25, gap: 5 * SECOND, from: 5 });
            await app.advance(MINUTE);
            await app.runDueJobs(BURST_JOB);

            expect(texts(app.slack.messages).filter((text: string): boolean => text.startsWith("🧹"))).toStrictEqual([
                "🧹 Removal burst: 26 posts removed",
            ]);
        },
    );

    it("is alerted one by one, logged, when its summary cannot be scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("scheduler down");
        const realRunJob = app.context.scheduler.runJob.getMockImplementation();
        app.context.scheduler.runJob.mockImplementation(async (job): Promise<string> => {
            if (job.name === BURST_JOB) {
                throw failure;
            }
            if (realRunJob === undefined) {
                throw new Error("the fake scheduler has no runJob");
            }
            return await realRunJob(job);
        });

        await removals(app, { count: 8, gap: SECOND });

        expect(app.slack.messages).toHaveLength(8);
        expect(lines(app.slack.messages[7])).not.toContain(BURST_LINE);
        expect(console.warn).toHaveBeenCalledWith(
            "[burst] Could not schedule a burst's summary, so alerting its removals one by one:",
            failure,
        );
    });

    it("leaves only its runs' claims, for an hour, once summarised", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await removals(app, { count: 6, gap: SECOND });
        const [job] = burstJobs(app.context.scheduler.jobs);

        await app.advance(2 * MINUTE);
        await app.runDueJobs(BURST_JOB);

        const runKey = `mod_actions:burst_run:testsub:moda:${String(job?.runAt?.getTime())}`;

        expect(
            app.context.redis.keys().filter((key: string): boolean => key.startsWith("mod_actions:burst")),
        ).toStrictEqual([runKey]);
        expect(app.context.redis.ttlSeconds(runKey)).toBe(3600);
    });
});

describe("a sweep of removals by Reddit's admins", (): void => {
    it("is summarised in Reddit's style, with the whole mod log", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await removals(app, { count: 10, gap: SECOND, moderator: "Anti-Evil Operations" });
        await app.advance(2 * MINUTE);
        await app.runDueJobs(BURST_JOB);

        expect(lines(app.slack.messages[4]).slice(-2)).toStrictEqual([
            "• *Status:* Origin Reddit",
            "• *Burst:* Further removals by Anti-Evil Operations will be summarised",
        ]);
        expect(lines(app.slack.messages[5])).toStrictEqual([
            "🧹 *Removal Burst*",
            "• *Reddit account:* Anti-Evil Operations",
            "• *Removed:* 6 posts",
            "• *When:* 2026-11-04 12:00:04 UTC to 2026-11-04 12:00:09 UTC",
            "• *Mod log:* <https://old.reddit.com/r/testsub/about/log/|Open the mod log>",
        ]);
    });
});
