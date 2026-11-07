import type { ModeratorRef } from "../domain/activity.js";
import type { BanLogEntry } from "../domain/banDuration.js";
import type { Burst, BurstSummary, RemovalType } from "../domain/burst.js";
import type { DisciplineEvent, DisciplineSubject } from "../domain/discipline.js";
import type { NoteEntry } from "../domain/history.js";
import type { Actor, ModAction } from "../domain/modAction.js";

/** What mod-action alerts keep between actions. Each method rejects when storage fails. */
export interface ModerationRecords {
    /**
     * Counts one of the moderator's actions, taken at `action.at` (ms since the epoch), and returns how many of
     * their actions were taken within `windowMs` up to then, this one included. Safe to call for actions arriving
     * at once: each is counted. An action counted again under the same ID counts once.
     */
    readonly countAction: (
        moderator: ModeratorRef,
        action: Readonly<{ id: string | undefined; at: number }>,
        windowMs: number,
    ) => Promise<number>;
    /**
     * Records a ban or mute imposed or lifted, for 90 days. Safe for events arriving at once or out of order; an
     * event recorded twice is kept once.
     */
    readonly recordDiscipline: (subject: DisciplineSubject, event: DisciplineEvent) => Promise<void>;
    /** The subject's recorded events, in no particular order; [] when none. */
    readonly disciplineEvents: (subject: DisciplineSubject) => Promise<readonly DisciplineEvent[]>;
    /**
     * Claims the report of the action with this ID: true the first time, false when it was already claimed within
     * the last day, as for an event Devvit delivers again. Safe for deliveries handled at once: one claims it.
     */
    readonly claimReport: (actionId: string) => Promise<boolean>;
}

/** What mod-action alerts look up on Reddit. */
export interface ModerationLookups {
    /** Whether the user is on the subreddit's mod list, ignoring case. Rejects when the list cannot be fetched. */
    readonly isModerator: (username: string) => Promise<boolean>;
    /** The latest bans in the named subreddit's mod log, or the current subreddit's when none is named. */
    readonly recentBans: (subredditName: string | undefined) => Promise<readonly BanLogEntry[]>;
    /**
     * The user's entries in the named subreddit's mod notes (the current subreddit's when none is named), newest
     * first, at most 100. Rejects when they cannot be read.
     */
    readonly modNotes: (subredditName: string | undefined, username: string) => Promise<readonly NoteEntry[]>;
}

export interface ModActionAlerts {
    /**
     * Tells moderators about the action, taken by `actor`: an unknown moderator's goes out as a security alert. One
     * that `opensBurst` says that its account's further removals will be summarised. Delivery may come later. Never
     * rejects.
     */
    readonly report: (modAction: ModAction, actor: Actor, opensBurst: boolean) => Promise<void>;
    /** Tells moderators about a burst of removals: its running totals while it lasts, then its total. Never rejects. */
    readonly reportBurst: (summary: BurstSummary) => Promise<void>;
}

/** What counting a removal in its account's burst found. Times are in ms since the epoch. */
export interface BurstJoin {
    /** Whether this removal opened the burst: none was open. */
    readonly opened: boolean;
    /** When the burst opened. */
    readonly openedAt: number;
    /** When its summary is due; undefined until the removal that opened it has scheduled one. */
    readonly due: number | undefined;
}

/** Where open bursts of removals are kept, by account. Each method rejects when storage fails. */
export interface BurstRecords {
    /**
     * Counts the removal, handled at `now`, in the account's burst, opening one when none is open: all at once, so
     * neither another removal nor a run closing the burst falls between.
     */
    readonly join: (account: ModeratorRef, type: RemovalType, now: number) => Promise<BurstJoin>;
    /** Notes when the burst's summary next runs. */
    readonly setDue: (account: ModeratorRef, due: number) => Promise<void>;
    /** The account's open burst; undefined when none is open. */
    readonly read: (account: ModeratorRef) => Promise<Burst | undefined>;
    /** Notes that a progress summary went at `at`. */
    readonly noteProgress: (account: ModeratorRef, at: number) => Promise<void>;
    /**
     * Ends the burst, for the run due at `due`: takes it out of the way at once, so a removal after opens a new one,
     * and returns what it held; undefined when none was open.
     */
    readonly close: (account: ModeratorRef, due: number) => Promise<Burst | undefined>;
    /** Forgets the burst: one whose summary could not be scheduled. */
    readonly discard: (account: ModeratorRef) => Promise<void>;
    /** Claims the run due at `due`: true once, false for a run the scheduler delivers again. */
    readonly claimRun: (account: ModeratorRef, due: number) => Promise<boolean>;
    /** Claims the rescue of a summary overdue since `since`: true once, so one removal schedules it again. */
    readonly claimRescue: (account: ModeratorRef, since: number) => Promise<boolean>;
}

/** When a burst's summary runs. Rejects when the scheduler refuses. */
export interface BurstSchedule {
    readonly summariseAt: (account: ModeratorRef, due: number) => Promise<void>;
}

/** Where a simulated action's alert goes: straight to moderators, who wait on the result. */
export interface SimulationAlerts {
    /** Sends the alert the action would produce, as a moderator's: true when it was delivered. Never rejects. */
    readonly deliver: (modAction: ModAction) => Promise<boolean>;
}
