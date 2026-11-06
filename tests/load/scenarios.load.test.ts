import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { QueueItem } from "../fixtures/fakeReddit.js";
import { drive, settle, statsOf } from "./driver.js";
import type { Profile, RunResult } from "./driver.js";
import { createEventStream, REALISTIC_SHAPE, seededRandom, STEADY_MIX } from "./events.js";
import type { EventKind, Shape } from "./events.js";
import { createHarness, loadSettings, NO_FAULTS } from "./harness.js";
import type { Harness } from "./harness.js";
import { checkInvariants } from "./invariants.js";
import type { Check } from "./invariants.js";
import { seed } from "./seed.js";
import type { Volume } from "./seed.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

/**
 * The load scenarios. Run with `npm run load` against a Redis it may empty: `npm run load:redis` starts one in Docker
 * on port 6390. LOAD_SCENARIOS names those to run (all by default); each writes load-results/<scenario>.json.
 */

const REDIS_URL = process.env["LOAD_REDIS_URL"] ?? "redis://localhost:6390";
const SELECTED = (process.env["LOAD_SCENARIOS"] ?? "").split(",").filter((name: string): boolean => name !== "");
const MINUTE = 60_000;

function selected(name: string): boolean {
    return SELECTED.length === 0 || SELECTED.includes(name);
}

function record(name: string, result: unknown): void {
    mkdirSync("load-results", { recursive: true });
    writeFileSync(`load-results/${name}.json`, `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(`\n=== ${name} ===\n${JSON.stringify(result, null, 2)}\n`);
}

/** The modqueue as a busy subreddit's, at a volume: 50 items, times the volume. */
function queueItems(volume: Volume): QueueItem[] {
    return Array.from({ length: 50 * volume }, (_unused: unknown, index: number): QueueItem => ({
        id: `t1_q${String(index)}`,
        createdAt: new Date(Date.now() - index * MINUTE),
        permalink: `/r/testsub/comments/p/a_title/q${String(index)}/`,
    }));
}

/** A fresh installation: an emptied Redis, seeded at the volume. */
async function fresh(volume: Volume, settings = loadSettings()): Promise<Harness> {
    const harness = await createHarness(devvit, { redisUrl: REDIS_URL, settings });
    await harness.client.sendCommand(["FLUSHDB"]);
    await seed(harness.client, volume);
    await harness.client.sendCommand([
        "SET",
        "slack_connection",
        JSON.stringify({ token: "xoxb-load", team: "Load Workspace" }),
    ]);
    harness.reddit.modQueue = queueItems(volume);
    harness.reddit.unmoderated = queueItems(volume);
    harness.reddit.reports = queueItems(volume);
    return harness;
}

function profile(fields: Partial<Profile> & Pick<Profile, "name">): Profile {
    return {
        ratePerMinute: 30,
        durationMs: 5 * MINUTE,
        concurrency: 8,
        duplicates: 0,
        duplicateDelayMs: 0,
        jobsEveryMs: undefined,
        ...fields,
    };
}

function holds(checks: readonly Check[]): boolean {
    return checks.every(({ holds: held }: Check): boolean => held);
}

async function run(
    harness: Harness,
    runProfile: Profile,
    shape: Shape = REALISTIC_SHAPE,
    seedNumber = 1,
): Promise<Readonly<{ result: RunResult; checks: readonly Check[] }>> {
    const result = await drive(
        harness,
        createEventStream(STEADY_MIX, shape, seedNumber),
        runProfile,
        seededRandom(seedNumber + 1),
    );
    return { result, checks: await checkInvariants(harness) };
}

const KINDS: readonly EventKind[] = Object.keys(STEADY_MIX).filter(
    (kind: string): kind is EventKind => kind in STEADY_MIX,
);
const SCENARIO_MS = 3_600_000;

describe("the load scenarios", (): void => {
    it.runIf(selected("baseline"))(
        "baseline: each handler, one event at a time",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const harness = await fresh(1);
            const generator = createEventStream(STEADY_MIX, REALISTIC_SHAPE, 7);
            for (const kind of KINDS) {
                for (let index = 0; index < 20; index += 1) {
                    const event = generator.next(kind);
                    await harness.deliver(event.type, event.event).catch((): void => undefined);
                }
            }
            // The recovery drains each alert's drain scheduled run as the scheduler would: as their own invocations.
            await settle(harness, 120_000);
            const events = statsOf(harness.lines());
            const checks = await checkInvariants(harness);
            const jobs: Record<string, unknown> = {};
            for (const volume of [1, 10, 100] as const) {
                const seeded = await fresh(
                    volume,
                    loadSettings({
                        dailySummary: true,
                        weeklyStatistics: true,
                        spamQueueThreshold: 1,
                        editedQueueThreshold: 1,
                    }),
                );
                for (const name of ["modqueueMonitor", "dailySummary", "weeklyStatistics", "slackOutbox"]) {
                    await seeded.runJob(name);
                }
                jobs[`volume ${String(volume)}`] = statsOf(seeded.lines());
                await seeded.close();
            }
            record("baseline", { events, jobs, checks });
            await harness.close();

            expect(Object.keys(events).length).toBeGreaterThan(0);
        },
    );

    it.runIf(selected("steady"))(
        "steady: a busy subreddit for five minutes",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const harness = await fresh(1);
            const outcome = await run(harness, profile({ name: "steady", ratePerMinute: 30 }));
            record("steady", outcome);
            await harness.close();

            expect(holds(outcome.checks)).toBe(true);
        },
    );

    it.runIf(selected("ramp"))(
        "ramp: rising rates until the budget or errors give",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const steps: unknown[] = [];
            let broke: unknown;
            for (const rate of [60, 150, 300, 600, 1200, 2400, 4800]) {
                const harness = await fresh(1);
                const { result, checks } = await run(
                    harness,
                    profile({ name: `ramp ${String(rate)}`, ratePerMinute: rate, durationMs: MINUTE, concurrency: 32 }),
                );
                await harness.close();
                const handled = Object.values(result.handlers);
                const invocations = handled.reduce((sum: number, { count: total }): number => sum + total, 0);
                const failures = handled.reduce(
                    (sum: number, { failed, overBudget }): number => sum + failed + overBudget,
                    0,
                );
                const worstP95 = Math.max(...handled.map(({ p95 }): number => p95));
                steps.push({
                    rate,
                    invocations,
                    failures,
                    worstP95,
                    waitP95: result.waitP95,
                    redisOpsPerSecond: result.redisOpsPerSecond,
                    checks: holds(checks),
                });
                if (
                    broke === undefined &&
                    (failures > invocations / 100 || worstP95 >= 30_000 || result.waitP95 >= 30_000 || !holds(checks))
                ) {
                    broke = {
                        rate,
                        failures,
                        worstP95,
                        waitP95: result.waitP95,
                        checks: checks.filter(({ holds: held }): boolean => !held),
                    };
                    break;
                }
            }
            record("ramp", { steps, broke });

            expect(steps.length).toBeGreaterThan(0);
        },
    );

    it.runIf(selected("flood"))(
        "flood: one thread and a few authors, ten times the rate",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const harness = await fresh(1);
            const outcome = await run(
                harness,
                profile({ name: "flood", ratePerMinute: 300, durationMs: MINUTE, concurrency: 32 }),
                { authors: 50, posts: 5, hotPostShare: 0.9, hotAuthorShare: 0.5 },
            );
            record("flood", outcome);
            await harness.close();

            expect(holds(outcome.checks)).toBe(true);
        },
    );

    it.runIf(selected("duplicates"))(
        "duplicates: every event twice, some out of order",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const once = await fresh(1);
            const control = await run(
                once,
                profile({ name: "once", ratePerMinute: 60, durationMs: 2 * MINUTE }),
                REALISTIC_SHAPE,
                11,
            );
            const alerts = new Set(
                once.slack.requests
                    .filter(({ api }): boolean => api === "chat.postMessage")
                    .map(({ body }): string => JSON.stringify(body)),
            ).size;
            await once.close();
            const twice = await fresh(1);
            const result = await drive(
                twice,
                createEventStream(STEADY_MIX, REALISTIC_SHAPE, 11),
                profile({
                    name: "twice",
                    ratePerMinute: 60,
                    durationMs: 2 * MINUTE,
                    duplicates: 1,
                    duplicateDelayMs: 2000,
                }),
                seededRandom(12),
            );
            const checks = await checkInvariants(twice, { alerts });
            record("duplicates", { control: control.result, controlAlerts: alerts, twice: result, checks });
            await twice.close();

            expect(holds(checks)).toBe(true);
        },
    );

    it.runIf(selected("storm"))(
        "storm: a moderator removes 200 items in a minute",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const harness = await fresh(1);
            const generator = createEventStream(
                {
                    ...STEADY_MIX,
                    commentEdit: 0,
                    commentDelete: 0,
                    commentReport: 0,
                    commentFiltered: 0,
                    postEdit: 0,
                    postDelete: 0,
                    postReport: 0,
                    modmail: 0,
                },
                REALISTIC_SHAPE,
                21,
            );
            const result = await drive(
                harness,
                generator,
                profile({ name: "storm", ratePerMinute: 200, durationMs: MINUTE, concurrency: 32 }),
                seededRandom(22),
            );
            const checks = await checkInvariants(harness);
            record("storm", { result, checks });
            await harness.close();

            expect(holds(checks)).toBe(true);
        },
    );

    it.runIf(selected("degradation"))(
        "degradation: Reddit slow, then rate-limiting",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const phases = [
                ["reddit 500 ms", { ...NO_FAULTS, redditLatencyMs: 500 }],
                ["reddit 2 s", { ...NO_FAULTS, redditLatencyMs: 2000 }],
                ["reddit 10% rate-limited", { ...NO_FAULTS, redditRateLimited: 0.1 }],
                ["reddit all rate-limited", { ...NO_FAULTS, redditRateLimited: 1 }],
                ["slack 20% failing", { ...NO_FAULTS, slackFailureRate: 0.2 }],
            ] as const;
            const results: unknown[] = [];
            for (const [name, faults] of phases) {
                const harness = await fresh(1);
                Object.assign(harness.faults, faults);
                results.push({
                    name,
                    ...(await run(harness, profile({ name, ratePerMinute: 60, durationMs: MINUTE }))),
                });
                await harness.close();
            }
            record("degradation", results);

            expect(results).toHaveLength(phases.length);
        },
    );

    it.runIf(selected("scheduler"))(
        "scheduler: the jobs at a hundred times the data, under the event stream",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const harness = await fresh(
                100,
                loadSettings({
                    dailySummary: true,
                    weeklyStatistics: true,
                    spamQueueThreshold: 1,
                    editedQueueThreshold: 1,
                }),
            );
            const outcome = await run(
                harness,
                profile({ name: "scheduler", ratePerMinute: 60, durationMs: 2 * MINUTE, jobsEveryMs: 10_000 }),
            );
            record("scheduler", outcome);
            await harness.close();

            expect(holds(outcome.checks)).toBe(true);
        },
    );

    it.runIf(selected("growth"))(
        "growth: the steady stream at ten and a hundred times the data",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const results: Record<string, unknown> = {};
            for (const volume of [1, 10, 100] as const) {
                const harness = await fresh(volume);
                results[`volume ${String(volume)}`] = await run(
                    harness,
                    profile({ name: `growth ${String(volume)}`, ratePerMinute: 60, durationMs: 2 * MINUTE }),
                );
                await harness.close();
            }
            record("growth", results);

            expect(Object.keys(results)).toHaveLength(3);
        },
    );

    it.runIf(selected("soak"))(
        "soak: the steady stream for thirty minutes",
        { timeout: SCENARIO_MS },
        async (): Promise<void> => {
            expect.hasAssertions();

            const harness = await fresh(1);
            const windows: unknown[] = [];
            for (let window = 0; window < 6; window += 1) {
                const { result } = await run(
                    harness,
                    profile({ name: `soak ${String(window)}`, ratePerMinute: 60, durationMs: 5 * MINUTE }),
                    REALISTIC_SHAPE,
                    31 + window,
                );
                const memory = process.memoryUsage();
                const info = String(await harness.client.sendCommand(["INFO", "memory"]));
                windows.push({
                    window,
                    p95: Object.fromEntries(
                        Object.entries(result.handlers).map(([name, { p95 }]): [string, number] => [name, p95]),
                    ),
                    heapMb: Math.round(memory.heapUsed / 1_048_576),
                    rssMb: Math.round(memory.rss / 1_048_576),
                    redisKeys: Number(await harness.client.sendCommand(["DBSIZE"])),
                    redisUsedMemory: /used_memory:(?<bytes>\d+)/u.exec(info)?.groups?.["bytes"],
                });
            }
            const checks = await checkInvariants(harness);
            record("soak", { windows, checks });
            await harness.close();

            expect(holds(checks)).toBe(true);
        },
    );
});
