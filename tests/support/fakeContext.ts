import { vi } from "vitest";
import type { Mock } from "vitest";

/**
 * A stand-in for the Devvit context the app's handlers receive. It implements only the members the app uses, and
 * returns Reddit listings synchronously, as Devvit does. Every method is a vi.fn, so a test can make one fail
 * (`mockRejectedValueOnce`) or count its calls; a listing fails through its `all` mock.
 */

export const SUBREDDIT = "testsub";
export const WEBHOOK_URL = "https://hooks.slack.com/services/T000/B000/XXXX";

const MS_PER_SECOND = 1000;
const DEFAULT_MODQUEUE_THRESHOLD = 50;
const DEFAULT_UNMODERATED_AGE_HOURS = 24;
const DEFAULT_POST_DELETION_UPVOTE_THRESHOLD = 100;

/** Installation settings as a moderator would have saved them. Keys are the setting names the app registers. */
export interface Settings {
    slackWebhookUrl?: unknown;
    enabledActions?: unknown;
    excludedModerators?: unknown;
    flagUnknownModerators?: unknown;
    includeModNote?: unknown;
    notificationChannel?: unknown;
    alertChannel?: unknown;
    modqueueThreshold?: unknown;
    unmoderagedAgeHours?: unknown;
    enableAutoModAlerts?: unknown;
    postDeletionUpvoteThreshold?: unknown;
}

/** The app's own setting defaults, with a webhook configured. */
export function defaultSettings(): Settings {
    return {
        slackWebhookUrl: WEBHOOK_URL,
        enabledActions: ["removelink", "removecomment", "spamlink", "spamcomment", "banuser", "unbanuser"],
        flagUnknownModerators: true,
        includeModNote: true,
        modqueueThreshold: DEFAULT_MODQUEUE_THRESHOLD,
        unmoderagedAgeHours: DEFAULT_UNMODERATED_AGE_HOURS,
        enableAutoModAlerts: false,
        postDeletionUpvoteThreshold: DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
    };
}

/** A modqueue entry. Posts have a title; comments do not. */
export interface QueueItem {
    readonly id: string;
    readonly title?: string;
    readonly createdAt: Date;
    readonly permalink: string;
}

/** A mod log entry, as `reddit.getModerationLog(...).get(n)` returns it. */
export interface ModLogEntry {
    readonly id: string;
    readonly moderatorName: string;
    readonly createdAt: Date;
    readonly details?: string;
    readonly description?: string;
    readonly target?: Readonly<{ author: string }>;
}

export interface ScheduledJob {
    readonly id: string;
    readonly name: string;
    readonly cron?: string;
}

export interface Toast {
    readonly text: string;
    readonly appearance?: string;
}

interface Entry {
    readonly value: string;
    readonly expiresAt: number | undefined;
}

export interface FakeRedis {
    readonly get: Mock<(key: string) => Promise<string | undefined>>;
    readonly set: Mock<(key: string, value: string, options?: Readonly<{ expiration?: Date }>) => Promise<string>>;
    readonly del: Mock<(...keys: readonly string[]) => Promise<void>>;
    readonly incrBy: Mock<(key: string, increment: number) => Promise<number>>;
    readonly expire: Mock<(key: string, seconds: number) => Promise<void>>;
    /** Live keys, sorted. */
    readonly keys: () => readonly string[];
    /** Seconds until `key` expires, or undefined when it does not expire (or does not exist). */
    readonly ttlSeconds: (key: string) => number | undefined;
    /** Writes a value directly, as an earlier app version might have left it. */
    readonly seed: (key: string, value: string) => void;
}

function createFakeRedis(): FakeRedis {
    const entries = new Map<string, Entry>();
    const live = (key: string): Entry | undefined => {
        const entry = entries.get(key);
        if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
            entries.delete(key);
            return undefined;
        }
        return entry;
    };
    return {
        get: vi.fn(async (key: string): Promise<string | undefined> => await Promise.resolve(live(key)?.value)),
        set: vi.fn(async (key: string, value: string, options?: Readonly<{ expiration?: Date }>): Promise<string> => {
            entries.set(key, { value, expiresAt: options?.expiration?.getTime() });
            return await Promise.resolve("OK");
        }),
        del: vi.fn(async (...keys: readonly string[]): Promise<void> => {
            for (const key of keys) {
                entries.delete(key);
            }
            await Promise.resolve();
        }),
        incrBy: vi.fn(async (key: string, increment: number): Promise<number> => {
            const entry = live(key);
            const next = (entry === undefined ? 0 : Number(entry.value)) + increment;
            entries.set(key, { value: String(next), expiresAt: entry?.expiresAt });
            return await Promise.resolve(next);
        }),
        expire: vi.fn(async (key: string, seconds: number): Promise<void> => {
            const entry = live(key);
            if (entry !== undefined) {
                entries.set(key, { ...entry, expiresAt: Date.now() + seconds * MS_PER_SECOND });
            }
            await Promise.resolve();
        }),
        keys: (): readonly string[] =>
            [...entries.keys()]
                .filter((key: string): boolean => live(key) !== undefined)
                .sort((first: string, second: string): number => first.localeCompare(second)),
        ttlSeconds: (key: string): number | undefined => {
            const expiresAt = live(key)?.expiresAt;
            return expiresAt === undefined ? undefined : (expiresAt - Date.now()) / MS_PER_SECOND;
        },
        seed: (key: string, value: string): void => {
            entries.set(key, { value, expiresAt: undefined });
        },
    };
}

interface Listing<T> {
    readonly all: () => Promise<readonly T[]>;
}

export interface FakeReddit {
    /** The mod list's usernames. */
    moderators: readonly string[];
    modQueue: readonly QueueItem[];
    modLog: readonly ModLogEntry[];
    readonly moderatorsAll: Mock<() => Promise<readonly Readonly<{ username: string }>[]>>;
    readonly modQueueAll: Mock<() => Promise<readonly QueueItem[]>>;
    readonly getModerators: Mock<() => Listing<Readonly<{ username: string }>>>;
    readonly getModQueue: Mock<(options: Readonly<{ type: string }>) => Listing<QueueItem>>;
    readonly getCurrentSubreddit: Mock<() => Promise<FakeSubreddit>>;
    readonly getCurrentSubredditName: Mock<() => Promise<string>>;
    readonly getModerationLog: Mock<
        (options: Readonly<{ subredditName: string; type: string; limit: number }>) => {
            readonly get: (count: number) => Promise<readonly ModLogEntry[]>;
        }
    >;
}

interface FakeSubreddit {
    readonly name: string;
    readonly getModerators: FakeReddit["getModerators"];
    readonly getModQueue: FakeReddit["getModQueue"];
}

function createFakeReddit(subredditName: string): FakeReddit {
    const reddit: Pick<FakeReddit, "moderators" | "modQueue" | "modLog"> = {
        moderators: ["ModA", "ModB"],
        modQueue: [],
        modLog: [],
    };
    const moderatorsAll = vi.fn(
        async (): Promise<readonly Readonly<{ username: string }>[]> =>
            await Promise.resolve(reddit.moderators.map((username: string): { username: string } => ({ username }))),
    );
    const modQueueAll = vi.fn(async (): Promise<readonly QueueItem[]> => await Promise.resolve(reddit.modQueue));
    const getModerators = vi.fn((): Listing<Readonly<{ username: string }>> => ({ all: moderatorsAll }));
    const getModQueue: FakeReddit["getModQueue"] = vi.fn((): Listing<QueueItem> => ({ all: modQueueAll }));
    const getModerationLog: FakeReddit["getModerationLog"] = vi.fn(
        (): { readonly get: (count: number) => Promise<readonly ModLogEntry[]> } => ({
            get: async (count: number): Promise<readonly ModLogEntry[]> =>
                await Promise.resolve(reddit.modLog.slice(0, count)),
        }),
    );
    return Object.assign(reddit, {
        moderatorsAll,
        modQueueAll,
        getModerators,
        getModQueue,
        getCurrentSubreddit: vi.fn(
            async (): Promise<FakeSubreddit> =>
                await Promise.resolve({ name: subredditName, getModerators, getModQueue }),
        ),
        getCurrentSubredditName: vi.fn(async (): Promise<string> => await Promise.resolve(subredditName)),
        getModerationLog,
    });
}

export interface FakeScheduler {
    jobs: readonly ScheduledJob[];
    readonly runJob: Mock<(job: Readonly<{ name: string; cron?: string }>) => Promise<string>>;
    readonly cancelJob: Mock<(id: string) => Promise<void>>;
    readonly listJobs: Mock<() => Promise<readonly ScheduledJob[]>>;
}

function createFakeScheduler(): FakeScheduler {
    const scheduler: Pick<FakeScheduler, "jobs"> = { jobs: [] };
    let nextId = 1;
    return Object.assign(scheduler, {
        runJob: vi.fn(async (job: Readonly<{ name: string; cron?: string }>): Promise<string> => {
            const id = `job-${String(nextId)}`;
            nextId += 1;
            scheduler.jobs = [...scheduler.jobs, job.cron === undefined ? { id, name: job.name } : { id, ...job }];
            return await Promise.resolve(id);
        }),
        cancelJob: vi.fn(async (id: string): Promise<void> => {
            scheduler.jobs = scheduler.jobs.filter((job: ScheduledJob): boolean => job.id !== id);
            await Promise.resolve();
        }),
        listJobs: vi.fn(async (): Promise<readonly ScheduledJob[]> => await Promise.resolve(scheduler.jobs)),
    });
}

export interface FakeContext {
    readonly subredditName: string;
    readonly settings: Readonly<{ get: Mock<(name: string) => Promise<unknown>> }>;
    readonly redis: FakeRedis;
    readonly reddit: FakeReddit;
    readonly scheduler: FakeScheduler;
    readonly ui: Readonly<{
        showToast: Mock<(toast: Toast) => void>;
        showForm: Mock<(formKey: string) => void>;
    }>;
}

export interface CreatedContext {
    readonly context: FakeContext;
    readonly toasts: readonly Toast[];
    readonly shownForms: readonly string[];
}

/** A context reading `settings`, which the test may change later. */
export function createFakeContext(settings: Readonly<Settings>): CreatedContext {
    const toasts: Toast[] = [];
    const shownForms: string[] = [];
    const settingValues: Readonly<Record<string, unknown>> = settings;
    return {
        context: {
            subredditName: SUBREDDIT,
            settings: {
                get: vi.fn(async (name: string): Promise<unknown> => await Promise.resolve(settingValues[name])),
            },
            redis: createFakeRedis(),
            reddit: createFakeReddit(SUBREDDIT),
            scheduler: createFakeScheduler(),
            ui: {
                showToast: vi.fn((toast: Toast): void => {
                    toasts.push(toast);
                }),
                showForm: vi.fn((formKey: string): void => {
                    shownForms.push(formKey);
                }),
            },
        },
        toasts,
        shownForms,
    };
}
