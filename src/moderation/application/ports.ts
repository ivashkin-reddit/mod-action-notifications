import type { BanLogEntry } from "../domain/banDuration.js";
import type { DisciplineEvent, DisciplineSubject } from "../domain/discipline.js";
import type { Actor, ModAction } from "../domain/modAction.js";

/** A moderator of a subreddit. */
export interface ModeratorRef {
    readonly subredditName: string;
    readonly moderatorName: string;
}

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
}

/** What mod-action alerts look up on Reddit. */
export interface ModerationLookups {
    /** Whether the user is on the subreddit's mod list, ignoring case. Rejects when the list cannot be fetched. */
    readonly isModerator: (username: string) => Promise<boolean>;
    /** The latest bans in the named subreddit's mod log, or the current subreddit's when none is named. */
    readonly recentBans: (subredditName: string | undefined) => Promise<readonly BanLogEntry[]>;
}

export interface ReportOptions {
    /** Who took the action; an unknown moderator's action is sent as a security alert. */
    readonly actor: Actor;
    /** A channel to send to instead of the configured one; '' for none. */
    readonly channel: string;
}

export interface ModActionAlerts {
    /** Tells moderators about the action: true when Slack accepted the alert. Never rejects. */
    readonly report: (modAction: ModAction, options: ReportOptions) => Promise<boolean>;
}
