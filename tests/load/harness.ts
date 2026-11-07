import { vi } from "vitest";
import { defaultSettings, SUBREDDIT } from "../fixtures/fakeContext.js";
import type { Settings } from "../fixtures/fakeContext.js";
import type { FakeDevvit, Handler, Registrations } from "../fixtures/fakeDevvit.js";
import { createFakeReddit } from "../fixtures/fakeReddit.js";
import type { FakeReddit } from "../fixtures/fakeReddit.js";
import { createFakeScheduler } from "../fixtures/fakeScheduler.js";
import type { FakeScheduler, ScheduledJob } from "../fixtures/fakeScheduler.js";
import { createFakeSlack } from "../fixtures/fakeSlack.js";
import type { FakeSlack } from "../fixtures/fakeSlack.js";
import { connectRedis, viewFor } from "./realRedis.js";
import type { RedisClient, Traffic } from "./realRedis.js";

/**
 * The load harness: the app's real handlers, as main.ts registers them, run with Devvit-shaped contexts whose Redis is
 * a real server and whose Reddit and Slack are the integration tests' fakes, with latency and failures injected. Every
 * invocation logs its completion line (Debug Logging is on), which the harness collects: the app's own
 * instrumentation is the measurement.
 */

/** The installation the harness plays. */
export const SUBREDDIT_ID = "t5_loadsub";
/** The moderators on the fake mod list; ModA to ModJ. */
export const MODERATORS: readonly string[] = [
    "ModA",
    "ModB",
    "ModC",
    "ModD",
    "ModE",
    "ModF",
    "ModG",
    "ModH",
    "ModI",
    "ModJ",
];

/** What Reddit and Slack do to each call: wait this long, then fail at this rate. */
export interface Faults {
    redditLatencyMs: number;
    /** Each Reddit call fails with "429 Too Many Requests" at this rate, from 0 to 1. */
    redditRateLimited: number;
    slackLatencyMs: number;
    /** Each Slack call answers 503 at this rate, from 0 to 1. */
    slackFailureRate: number;
}

export const NO_FAULTS: Faults = { redditLatencyMs: 0, redditRateLimited: 0, slackLatencyMs: 0, slackFailureRate: 0 };

/** An invocation's completion line, parsed. */
export type CompletionLine = Readonly<{
    handler: string;
    outcome: string;
    ms: number;
    redis: Readonly<{ n: number; ms: number }>;
    reddit: Readonly<{ n: number; ms: number }>;
    settings: Readonly<{ n: number; ms: number }>;
    scheduler: Readonly<{ n: number; ms: number }>;
    slack: Readonly<{ n: number; ms: number }>;
    failedCalls: number;
    alerts: number;
    eventBytes?: number;
    target?: string;
    error?: Readonly<{ code: string; stage: string }>;
}>;

/** The settings the harness installs with: alerts on for the common actions, both channels, Debug Logging on. */
export function loadSettings(overrides: Readonly<Settings> = {}): Settings {
    return {
        ...defaultSettings(),
        enabledActions: [
            "removelink",
            "removecomment",
            "spamlink",
            "spamcomment",
            "banuser",
            "unbanuser",
            "approvecomment",
        ],
        alertChannel: "C0456ALERT",
        urgentReportReasons: "threat, doxx",
        reportPileUpThreshold: 5,
        securityAlerts: true,
        debugLogging: true,
        ...overrides,
    };
}

/** A message Slack took: its request body, and when. */
export type Post = Readonly<{ body: string; at: number }>;

export type Harness = Readonly<{
    registrations: Registrations;
    /** Delivers a trigger event to its handler, as Devvit would; resolves when the handler settles. */
    deliver: (type: string, event: unknown) => Promise<void>;
    /** Runs a scheduler job's handler, as the scheduler would, with the data it was scheduled with. */
    runJob: (name: string, data?: unknown) => Promise<void>;
    /** Runs the one-off jobs now due, as the scheduler would: how many ran. */
    runDueJobs: () => Promise<number>;
    lines: () => readonly CompletionLine[];
    /** The messages Slack took, as their request bodies. */
    posted: () => readonly string[];
    /** The messages Slack took, as their request bodies, with when Slack took each, in ms since the epoch. */
    posts: () => readonly Post[];
    clearLines: () => void;
    slack: FakeSlack;
    reddit: FakeReddit;
    scheduler: FakeScheduler;
    client: RedisClient;
    /** Bytes sent to and received from Redis, across invocations. */
    traffic: Traffic;
    faults: Faults;
    settings: Settings;
    close: () => Promise<void>;
}>;

async function sleep(ms: number): Promise<void> {
    if (ms > 0) {
        await new Promise<void>((resolve: () => void): void => {
            setTimeout(resolve, ms);
        });
    }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
}

/** Reddit with the faults applied to each call that answers asynchronously; listings answer when read. */
function faulty<T extends object>(target: T, faults: Faults): T {
    return new Proxy(target, {
        get: (object: T, property: string | symbol): unknown => {
            const value: unknown = Reflect.get(object, property, object);
            if (typeof value === "function") {
                return (...args: readonly unknown[]): unknown => {
                    const result: unknown = Reflect.apply(value, object, args);
                    if (!isPromiseLike(result)) {
                        return result;
                    }
                    return (async (): Promise<unknown> => {
                        await sleep(faults.redditLatencyMs);
                        if (Math.random() < faults.redditRateLimited) {
                            throw new Error("429 Too Many Requests");
                        }
                        return await result;
                    })();
                };
            }
            return typeof value === "object" && value !== null && typeof property === "string" && property === "modMail"
                ? faulty(value, faults)
                : value;
        },
    });
}

function isTally(value: unknown): value is Readonly<{ n: number; ms: number }> {
    return (
        typeof value === "object" &&
        value !== null &&
        "n" in value &&
        typeof value.n === "number" &&
        "ms" in value &&
        typeof value.ms === "number"
    );
}

/** Whether the value has the completion line's shape, in the fields the harness reads. */
function isCompletionLine(value: unknown): value is CompletionLine {
    return (
        typeof value === "object" &&
        value !== null &&
        "handler" in value &&
        typeof value.handler === "string" &&
        "outcome" in value &&
        typeof value.outcome === "string" &&
        "ms" in value &&
        typeof value.ms === "number" &&
        "failedCalls" in value &&
        typeof value.failedCalls === "number" &&
        "alerts" in value &&
        typeof value.alerts === "number" &&
        ["redis", "reddit", "settings", "scheduler", "slack"].every((dependency: string): boolean =>
            isTally(new Map(Object.entries(value)).get(dependency)),
        )
    );
}

function parsed(line: unknown): CompletionLine | undefined {
    if (typeof line !== "string" || !line.startsWith("[invocation] ")) {
        return undefined;
    }
    const value: unknown = JSON.parse(line.slice("[invocation] ".length));
    return isCompletionLine(value) ? value : undefined;
}

export async function createHarness(
    devvit: FakeDevvit,
    { redisUrl, settings }: Readonly<{ redisUrl: string; settings: Settings }>,
): Promise<Harness> {
    const client = await connectRedis(redisUrl);
    const faults: Faults = { ...NO_FAULTS };
    const traffic: Traffic = { sent: 0, received: 0 };
    const reddit = createFakeReddit(SUBREDDIT);
    reddit.moderators = MODERATORS;
    const scheduler = createFakeScheduler();
    const slack = createFakeSlack();
    let lines: CompletionLine[] = [];
    /** The messages Slack took, as their request bodies, and when: failed attempts, retried, are not among them. */
    const posts: Post[] = [];
    const collect = (line: unknown): void => {
        const completion = parsed(line);
        if (completion !== undefined) {
            lines.push(completion);
        }
    };
    vi.spyOn(console, "info").mockImplementation(collect);
    vi.spyOn(console, "warn").mockImplementation(collect);
    vi.spyOn(console, "error").mockImplementation(collect);
    vi.stubGlobal(
        "fetch",
        async (url: string, init?: Parameters<FakeSlack["fetch"]>[1]): ReturnType<FakeSlack["fetch"]> => {
            await sleep(faults.slackLatencyMs);
            if (Math.random() < faults.slackFailureRate) {
                slack.respond(503);
            }
            const response = await slack.fetch(url, init);
            const answer: unknown = JSON.parse(await response.text());
            if (
                url.endsWith("chat.postMessage") &&
                typeof answer === "object" &&
                answer !== null &&
                "ok" in answer &&
                answer.ok === true
            ) {
                posts.push({ body: typeof init?.body === "string" ? init.body : "", at: Date.now() });
            }
            return response;
        },
    );
    devvit.reset();
    vi.resetModules();
    await import("../../src/main.js");
    const registrations = devvit.registrations();
    const contextFor = (): unknown => ({
        settings: {
            getAll: async (): Promise<Settings> => await Promise.resolve(settings),
        },
        redis: viewFor(client, traffic),
        reddit: faulty(reddit, faults),
        scheduler,
        subredditId: SUBREDDIT_ID,
        subredditName: SUBREDDIT,
        appVersion: "load",
        ui: { showForm: (): void => undefined, showToast: (): void => undefined },
    });
    const handlerOf = (handlers: Readonly<Record<string, Handler>>, name: string): Handler => {
        const handler = new Map(Object.entries(handlers)).get(name);
        if (handler === undefined) {
            throw new Error(`no handler for ${name}`);
        }
        return handler;
    };
    const runJob = async (name: string, data?: unknown): Promise<void> => {
        await handlerOf(registrations.schedulerJobs, name)({ name, data }, contextFor());
    };
    return {
        registrations,
        deliver: async (type: string, event: unknown): Promise<void> => {
            await handlerOf(registrations.triggers, type)(event, contextFor());
        },
        runJob,
        runDueJobs: async (): Promise<number> => {
            const now = Date.now();
            const due = scheduler.jobs.filter(
                (job: ScheduledJob): boolean => job.runAt !== undefined && job.runAt.getTime() <= now,
            );
            scheduler.jobs = scheduler.jobs.filter((job: ScheduledJob): boolean => !due.includes(job));
            await Promise.all(
                due.map(async ({ name, data }: ScheduledJob): Promise<void> => {
                    await runJob(name, data).catch((): void => undefined);
                }),
            );
            return due.length;
        },
        lines: (): readonly CompletionLine[] => lines,
        posted: (): readonly string[] => posts.map(({ body }: Post): string => body),
        posts: (): readonly Post[] => posts,
        clearLines: (): void => {
            lines = [];
        },
        slack,
        reddit,
        scheduler,
        client,
        traffic,
        faults,
        settings,
        close: async (): Promise<void> => {
            await client.quit();
        },
    };
}
