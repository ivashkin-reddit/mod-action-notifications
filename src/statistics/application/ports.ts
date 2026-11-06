import type { ActionTally } from "../domain/counting.js";
import type { DayCounts } from "../domain/report.js";

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
