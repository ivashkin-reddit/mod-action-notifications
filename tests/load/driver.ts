import { seededRandom } from "./events.js";
import type { EventStream, GeneratedEvent } from "./events.js";
import type { CompletionLine, Harness } from "./harness.js";
import { queuedIn } from "./invariants.js";

/**
 * Drives the harness with an event stream: events arrive at random (Poisson) at a rate, are handled at most
 * `concurrency` at a time, the rest waiting their turn, while due scheduler jobs run each second as the scheduler would
 * run them. Then it lets scheduled work finish, and summarises the completion lines.
 */

/**
 * The execution budget a handler is held to: the 30 seconds Devvit documents as its execution timeout for Devvit Web
 * and in its Redis guide (Devvit 0.15). It documents none for Blocks handlers, so this is an assumption.
 */
export const BUDGET_MS = 30_000;

export type Profile = Readonly<{
    name: string;
    ratePerMinute: number;
    durationMs: number;
    concurrency: number;
    /** The share of events delivered twice, the second copy up to `duplicateDelayMs` later. */
    duplicates: number;
    duplicateDelayMs: number;
    /** Runs the modqueue monitor, the daily summary and the weekly statistics this often, alongside the events. */
    jobsEveryMs: number | undefined;
}>;

export type HandlerStats = Readonly<{
    count: number;
    failed: number;
    overBudget: number;
    p50: number;
    p95: number;
    p99: number;
    max: number;
    redis: number;
    redisMax: number;
    reddit: number;
    settings: number;
    slack: number;
    scheduler: number;
    alerts: number;
    eventBytes: number;
}>;

export type RunResult = Readonly<{
    profile: string;
    events: number;
    elapsedMs: number;
    /** How long events waited for a free slot: p95, and the longest. */
    waitP95: number;
    waitMax: number;
    handlers: Readonly<Record<string, HandlerStats>>;
    redisOpsPerSecond: number;
    redditCallsPerMinute: number;
    slackCallsPerMinute: number;
    alertsSent: number;
    redisBytesSent: number;
    redisBytesReceived: number;
    rejected: number;
}>;

async function sleep(ms: number): Promise<void> {
    if (ms > 0) {
        await new Promise<void>((resolve: () => void): void => {
            setTimeout(resolve, ms);
        });
    }
}

function percentile(sorted: readonly number[], fraction: number): number {
    if (sorted.length === 0) {
        return 0;
    }
    return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

function mean(values: readonly number[]): number {
    return values.length === 0
        ? 0
        : Math.round((10 * values.reduce((sum: number, value: number): number => sum + value, 0)) / values.length) / 10;
}

/** Per-handler statistics from completion lines. */
export function statsOf(lines: readonly CompletionLine[]): Readonly<Record<string, HandlerStats>> {
    const byHandler = new Map<string, CompletionLine[]>();
    for (const line of lines) {
        byHandler.set(line.handler, [...(byHandler.get(line.handler) ?? []), line]);
    }
    return Object.fromEntries(
        [...byHandler].map(
            ([handler, handled]: readonly [string, readonly CompletionLine[]]): [string, HandlerStats] => {
                const durations = handled
                    .map(({ ms }: CompletionLine): number => ms)
                    .sort((first: number, second: number): number => first - second);
                return [
                    handler,
                    {
                        count: handled.length,
                        failed: handled.filter(({ outcome }: CompletionLine): boolean => outcome === "failed").length,
                        overBudget: durations.filter((ms: number): boolean => ms >= BUDGET_MS).length,
                        p50: percentile(durations, 0.5),
                        p95: percentile(durations, 0.95),
                        p99: percentile(durations, 0.99),
                        max: durations[durations.length - 1] ?? 0,
                        redis: mean(handled.map(({ redis }: CompletionLine): number => redis.n)),
                        redisMax: Math.max(0, ...handled.map(({ redis }: CompletionLine): number => redis.n)),
                        reddit: mean(handled.map(({ reddit }: CompletionLine): number => reddit.n)),
                        settings: mean(handled.map(({ settings }: CompletionLine): number => settings.n)),
                        slack: mean(handled.map(({ slack }: CompletionLine): number => slack.n)),
                        scheduler: mean(handled.map(({ scheduler }: CompletionLine): number => scheduler.n)),
                        alerts: handled.reduce((sum: number, { alerts }: CompletionLine): number => sum + alerts, 0),
                        eventBytes: mean(handled.map(({ eventBytes }: CompletionLine): number => eventBytes ?? 0)),
                    },
                ];
            },
        ),
    );
}

/** Runs scheduled one-off jobs as they fall due until none is left, or `maxMs` passes. */
export async function settle(harness: Harness, maxMs: number): Promise<void> {
    const until = Date.now() + maxMs;
    while (Date.now() < until) {
        await harness.runDueJobs();
        const pending = harness.scheduler.jobs.filter(({ runAt }): boolean => runAt !== undefined).length;
        const queued = await queuedIn(harness);
        if (pending === 0 && queued === 0) {
            return;
        }
        await sleep(500);
    }
}

/** Delivers events at the profile's rate and concurrency; returns what the completion lines say. */
export async function drive(
    harness: Harness,
    generator: EventStream,
    profile: Profile,
    random: () => number,
): Promise<RunResult> {
    harness.clearLines();
    const startedTraffic = { ...harness.traffic };
    const slackBefore = harness.slack.requests.length;
    const started = Date.now();
    const waits: number[] = [];
    let inFlight = 0;
    let rejected = 0;
    const waiting: (() => void)[] = [];
    const slot = async (): Promise<void> => {
        if (inFlight < profile.concurrency) {
            inFlight += 1;
            return;
        }
        await new Promise<void>((resolve: () => void): void => {
            waiting.push(resolve);
        });
        inFlight += 1;
    };
    const release = (): void => {
        inFlight -= 1;
        waiting.shift()?.();
    };
    const handle = async (event: GeneratedEvent): Promise<void> => {
        const arrived = Date.now();
        await slot();
        waits.push(Date.now() - arrived);
        try {
            await harness.deliver(event.type, event.event);
        } catch {
            rejected += 1;
        } finally {
            release();
        }
    };
    const work: Promise<void>[] = [];
    let jobsAt = started + (profile.jobsEveryMs ?? Number.POSITIVE_INFINITY);
    let dueAt = started;
    let events = 0;
    // Copies draw from their own stream, so a run with copies delivers the same events at the same times as one without.
    const copies = seededRandom(Math.floor(random() * 4_294_967_296));
    let next = started + (-Math.log(1 - random()) / profile.ratePerMinute) * 60_000;
    while (Date.now() - started < profile.durationMs) {
        const now = Date.now();
        if (now >= next) {
            const event = generator.next();
            events += 1;
            work.push(handle(event));
            if (copies() < profile.duplicates) {
                work.push(
                    (async (): Promise<void> => {
                        await sleep(copies() * profile.duplicateDelayMs);
                        await handle(event);
                    })(),
                );
            }
            next += (-Math.log(1 - random()) / profile.ratePerMinute) * 60_000;
        } else if (now >= dueAt) {
            dueAt = now + 1000;
            work.push(harness.runDueJobs().then((): void => undefined));
        } else if (profile.jobsEveryMs !== undefined && now >= jobsAt) {
            jobsAt = now + profile.jobsEveryMs;
            work.push(
                (async (): Promise<void> => {
                    await Promise.all(
                        ["modqueueMonitor", "dailySummary", "weeklyStatistics"].map(
                            async (name: string): Promise<void> => {
                                await harness.runJob(name).catch((): void => undefined);
                            },
                        ),
                    );
                })(),
            );
        } else {
            await sleep(Math.max(0, Math.min(next - Date.now(), dueAt - Date.now(), 50)));
        }
    }
    await Promise.all(work);
    await settle(harness, 120_000);
    const elapsedMs = Date.now() - started;
    const lines = harness.lines();
    const handlers = statsOf(lines);
    const totals = lines.reduce(
        (
            sum: Readonly<{ redis: number; reddit: number; alerts: number }>,
            line: CompletionLine,
        ): Readonly<{ redis: number; reddit: number; alerts: number }> => ({
            redis: sum.redis + line.redis.n,
            reddit: sum.reddit + line.reddit.n,
            alerts: sum.alerts + line.alerts,
        }),
        { redis: 0, reddit: 0, alerts: 0 },
    );
    const sortedWaits = [...waits].sort((first: number, second: number): number => first - second);
    return {
        profile: profile.name,
        events,
        elapsedMs,
        waitP95: percentile(sortedWaits, 0.95),
        waitMax: sortedWaits[sortedWaits.length - 1] ?? 0,
        handlers,
        redisOpsPerSecond: Math.round((totals.redis / elapsedMs) * 1000),
        redditCallsPerMinute: Math.round((totals.reddit / elapsedMs) * 60_000),
        slackCallsPerMinute: Math.round(((harness.slack.requests.length - slackBefore) / elapsedMs) * 60_000),
        alertsSent: totals.alerts,
        redisBytesSent: harness.traffic.sent - startedTraffic.sent,
        redisBytesReceived: harness.traffic.received - startedTraffic.received,
        rejected,
    };
}
