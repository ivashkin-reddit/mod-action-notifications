import type { ModeratorRef } from "../domain/activity.js";
import type { BanLogEntry } from "../domain/banDuration.js";
import type { DisciplineEvent, DisciplineSubject } from "../domain/discipline.js";
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
}

export interface ModActionAlerts {
    /**
     * Tells moderators about the action, taken by `actor`: an unknown moderator's goes out as a security alert.
     * Delivery may come later. Never rejects.
     */
    readonly report: (modAction: ModAction, actor: Actor) => Promise<void>;
}

/** Where a simulated action's alert goes: straight to moderators, who wait on the result. */
export interface SimulationAlerts {
    /** Sends the alert the action would produce, as a moderator's: true when it was delivered. Never rejects. */
    readonly deliver: (modAction: ModAction) => Promise<boolean>;
}
