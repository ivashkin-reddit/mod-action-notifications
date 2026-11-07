import type { ActionTally } from "../domain/counting.js";
import type { DayCounts } from "../domain/report.js";
import type { WaitingEntry } from "../domain/responses.js";

/** Where the team's statistics are kept: counts by UTC day, holding no username. Each method rejects when storage fails. */
export interface StatisticsStore {
    /**
     * Claims the counting of the action with this ID: true the first time, false when it was counted within the last
     * day, as for an event Devvit delivers again. Safe for deliveries handled at once: one claims it.
     */
    readonly claimCount: (actionId: string) => Promise<boolean>;
    /** Adds an action's tally to its day's counts. Each count is one atomic increment. */
    readonly addTally: (tally: ActionTally) => Promise<void>;
    /** The counts kept for a UTC day (YYYY-MM-DD); empty for a day with none. */
    readonly dayCounts: (day: string) => Promise<DayCounts>;
    /** Claims the digest of the week starting `from`: true the first time, false once it was sent. */
    readonly claimDigest: (from: string) => Promise<boolean>;
    /** Adds to a UTC day's outcome counts. Each count is one atomic increment. */
    readonly addOutcomes: (day: string, counts: Readonly<Record<string, number>>) => Promise<void>;
}

/**
 * What waits for a moderator: items reported or held by AutoModerator, conversations whose user awaits a reply, and
 * removals a moderator may yet reverse. It holds IDs, times and moderator hashes, never a username. Each method
 * rejects when storage fails.
 */
export interface WaitingStore {
    /** Notes that the item waits, unless it already does: the first report or filter sets the time. */
    readonly markAwaiting: (itemId: string, entry: WaitingEntry) => Promise<void>;
    /** Takes the item off the queue: its entry for the one call that took it, undefined for any other. */
    readonly takeAwaiting: (itemId: string) => Promise<WaitingEntry | undefined>;
    /** Notes who removed the item on a UTC day: "reddit", or the moderator's hash. */
    readonly noteRemoval: (day: string, itemId: string, remover: string) => Promise<void>;
    /** Takes who removed the item on any of these days: for the one call that took it, undefined for any other. */
    readonly takeRemoval: (days: readonly string[], itemId: string) => Promise<string | undefined>;
    /** Notes that a user waits for a reply in the conversation, unless one already does. */
    readonly markModmailWaiting: (conversationId: string, at: number) => Promise<void>;
    /** Takes since when a user waited for a reply: for the one call that took it, undefined for any other. */
    readonly takeModmailWaiting: (conversationId: string) => Promise<number | undefined>;
    /** Forgets what has waited over a week. */
    readonly prune: (now: number) => Promise<void>;
}

export interface ScheduledDigestJob {
    readonly id: string;
    /** Absent for a one-off job. */
    readonly cron: string | undefined;
}

export interface DigestScheduler {
    readonly schedule: (cron: string) => Promise<string>;
    readonly cancel: (jobId: string) => Promise<void>;
    /** The digest jobs scheduled for this installation. */
    readonly jobs: () => Promise<readonly ScheduledDigestJob[]>;
}
