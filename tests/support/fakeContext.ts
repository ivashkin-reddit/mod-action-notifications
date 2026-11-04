import { vi } from 'vitest';

/**
 * A stand-in for the Devvit context the app's handlers receive. It implements only the members src/main.ts
 * uses. Every method is a vi.fn, so a test can make one fail (`mockRejectedValueOnce`) or count its calls.
 */

export const SUBREDDIT = 'testsub';
export const WEBHOOK_URL = 'https://hooks.slack.com/services/T000/B000/XXXX';

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
    enabledActions: ['removelink', 'removecomment', 'spamlink', 'spamcomment', 'banuser', 'unbanuser'],
    flagUnknownModerators: true,
    includeModNote: true,
    modqueueThreshold: 50,
    unmoderagedAgeHours: 24,
    enableAutoModAlerts: false,
    postDeletionUpvoteThreshold: 100,
  };
}

/** A modqueue entry. Posts have a title; comments do not. */
export interface QueueItem {
  id: string;
  title?: string;
  createdAt: Date;
  permalink: string;
}

/** A mod log entry, as `reddit.getModerationLog(...).get(n)` returns it. */
export interface ModLogEntry {
  id: string;
  moderatorName?: string;
  createdAt: Date;
  details?: string;
  description?: string;
  target?: { author?: string };
}

export interface ScheduledJob {
  id: string;
  name: string;
  cron?: string;
}

interface Entry {
  value: string;
  expiresAt?: number;
}

export class FakeRedis {
  private readonly entries = new Map<string, Entry>();

  readonly get = vi.fn(async (key: string): Promise<string | undefined> => this.live(key)?.value);

  readonly set = vi.fn(async (key: string, value: string, options?: { expiration?: Date }): Promise<string> => {
    this.entries.set(key, { value, expiresAt: options?.expiration?.getTime() });
    return 'OK';
  });

  readonly del = vi.fn(async (...keys: string[]): Promise<void> => {
    for (const key of keys) {
      this.entries.delete(key);
    }
  });

  readonly incrBy = vi.fn(async (key: string, increment: number): Promise<number> => {
    const entry = this.live(key);
    const next = (entry ? Number(entry.value) : 0) + increment;
    this.entries.set(key, { value: String(next), expiresAt: entry?.expiresAt });
    return next;
  });

  readonly expire = vi.fn(async (key: string, seconds: number): Promise<void> => {
    const entry = this.live(key);
    if (entry) {
      entry.expiresAt = Date.now() + seconds * 1000;
    }
  });

  /** Live keys, sorted. */
  keys(): string[] {
    return [...this.entries.keys()].filter((key) => this.live(key) !== undefined).sort();
  }

  /** Seconds until `key` expires, or undefined when it does not expire (or does not exist). */
  ttlSeconds(key: string): number | undefined {
    const expiresAt = this.live(key)?.expiresAt;
    return expiresAt === undefined ? undefined : (expiresAt - Date.now()) / 1000;
  }

  /** Writes a value directly, as an earlier app version might have left it. */
  seed(key: string, value: string): void {
    this.entries.set(key, { value });
  }

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }
}

export class FakeReddit {
  moderators: string[] = ['ModA', 'ModB'];
  modQueue: QueueItem[] = [];
  modLog: ModLogEntry[] = [];

  readonly getModerators = vi.fn(async () => ({
    all: async () => this.moderators.map((username) => ({ username })),
  }));

  readonly getModQueue = vi.fn(async (_options: { type: string }) => ({
    all: async () => [...this.modQueue],
  }));

  readonly getCurrentSubreddit = vi.fn(async () => ({
    name: this.subredditName,
    getModerators: this.getModerators,
    getModQueue: this.getModQueue,
  }));

  readonly getCurrentSubredditName = vi.fn(async (): Promise<string> => this.subredditName);

  readonly getModerationLog = vi.fn((_options: { subredditName: string; type: string; limit: number }) => ({
    get: async (count: number) => this.modLog.slice(0, count),
  }));

  constructor(private readonly subredditName: string) {}
}

export class FakeScheduler {
  private nextId = 1;
  jobs: ScheduledJob[] = [];

  readonly runJob = vi.fn(async (job: { name: string; cron?: string }): Promise<string> => {
    const id = `job-${this.nextId++}`;
    this.jobs.push({ id, name: job.name, ...(job.cron === undefined ? {} : { cron: job.cron }) });
    return id;
  });

  readonly cancelJob = vi.fn(async (id: string): Promise<void> => {
    this.jobs = this.jobs.filter((job) => job.id !== id);
  });

  readonly listJobs = vi.fn(async (): Promise<ScheduledJob[]> => [...this.jobs]);
}

export interface Toast {
  text: string;
  appearance?: string;
}

export interface FakeContext {
  subredditName: string;
  settings: { get: (name: string) => Promise<unknown> };
  redis: FakeRedis;
  reddit: FakeReddit;
  scheduler: FakeScheduler;
  ui: {
    showToast: (toast: Toast) => void;
    showForm: (formKey: string) => void;
  };
}

export function createFakeContext(settings: Settings): {
  context: FakeContext;
  toasts: Toast[];
  shownForms: string[];
} {
  const toasts: Toast[] = [];
  const shownForms: string[] = [];
  const context: FakeContext = {
    subredditName: SUBREDDIT,
    settings: {
      get: vi.fn(async (name: string) => (settings as Record<string, unknown>)[name]),
    },
    redis: new FakeRedis(),
    reddit: new FakeReddit(SUBREDDIT),
    scheduler: new FakeScheduler(),
    ui: {
      showToast: vi.fn((toast: Toast) => {
        toasts.push(toast);
      }),
      showForm: vi.fn((formKey: string) => {
        shownForms.push(formKey);
      }),
    },
  };
  return { context, toasts, shownForms };
}
