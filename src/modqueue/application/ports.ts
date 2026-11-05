import type { QueueItem } from "../domain/monitoring.js";

/** The subreddit's moderation listings the monitor reads. Each rejects when Reddit cannot be read. */
export interface ModerationQueues {
    /** The modqueue: reported content and content Reddit's filters held back. */
    readonly modqueue: () => Promise<readonly QueueItem[]>;
    /** Content no moderator has reviewed yet. */
    readonly unmoderated: () => Promise<readonly QueueItem[]>;
    /** Reported content. */
    readonly reported: () => Promise<readonly QueueItem[]>;
}

/** The kinds of queue alert, each throttled on its own. */
export type QueueAlert = "queue-size" | "unmoderated" | "reported";

/** What the monitor keeps between runs. */
export interface MonitorStore {
    /** Claims the alert for the period: false when one of that kind was sent within it, true otherwise. */
    readonly claimAlert: (alert: QueueAlert, periodSeconds: number) => Promise<boolean>;
    /** Adds a failure to the count of consecutive failures and returns the new count. */
    readonly countFailure: () => Promise<number>;
    /** Forgets the failure count `seconds` from now, unless it changes first. */
    readonly expireFailuresAfter: (seconds: number) => Promise<void>;
    readonly clearFailures: () => Promise<void>;
    /** The monitor job setup last kept or scheduled, for Show Bot Status to name. */
    readonly monitorJobId: () => Promise<string | undefined>;
    readonly rememberMonitorJob: (jobId: string) => Promise<void>;
    readonly forgetMonitorJob: () => Promise<void>;
}

export interface ScheduledMonitorJob {
    readonly id: string;
    /** Absent for a one-off job. */
    readonly cron?: string;
}

export interface MonitorScheduler {
    /** Schedules the monitor job and returns its ID. */
    readonly schedule: (cron: string) => Promise<string>;
    readonly cancel: (jobId: string) => Promise<void>;
    /** The monitor jobs scheduled for this installation; the scheduler's record of what runs. */
    readonly jobs: () => Promise<readonly ScheduledMonitorJob[]>;
}

export interface QueueTooLongAlert {
    readonly size: number;
    readonly posts: number;
    readonly comments: number;
    readonly threshold: number;
}

/** Content that has reached an age limit. */
export interface AgedContentAlert {
    /** The oldest of the `total` waiting items, oldest first. */
    readonly oldest: readonly QueueItem[];
    readonly total: number;
    readonly ageHours: number;
    /** When ages are measured, in ms since the epoch. */
    readonly now: number;
}

export interface MonitorFailingAlert {
    readonly failures: number;
    /** The last failure's message, '' when it had none. */
    readonly error: string;
}

export interface ModqueueAlerts {
    readonly queueTooLong: (alert: QueueTooLongAlert) => Promise<void>;
    /** Content has waited unreviewed for the unmoderated age limit. */
    readonly waitingTooLong: (alert: AgedContentAlert) => Promise<void>;
    /** Reported content has reached the reported age limit. */
    readonly reportedContentOld: (alert: AgedContentAlert) => Promise<void>;
    readonly monitorFailing: (alert: MonitorFailingAlert) => Promise<void>;
}
