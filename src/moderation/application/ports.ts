import type { BanLogEntry } from "../domain/banDuration.js";
import type { DisciplineRecord, DisciplineSubject } from "../domain/discipline.js";
import type { ModAction, RelatedAction } from "../domain/modAction.js";

/** A moderator of a subreddit. */
export interface ModeratorRef {
    readonly subredditName: string;
    readonly moderatorName: string;
}

/** What mod-action alerts keep between actions. Each method rejects when storage fails. */
export interface ModerationRecords {
    /** The moderator's recent action times (ms since the epoch); [] when none are kept or they cannot be parsed. */
    readonly recentActionTimes: (moderator: ModeratorRef) => Promise<readonly number[]>;
    /** Keeps the moderator's recent action times for an hour. */
    readonly keepRecentActionTimes: (moderator: ModeratorRef, times: readonly number[]) => Promise<void>;
    /** Remembers the ban or mute for 90 days, replacing one already remembered. */
    readonly rememberDiscipline: (subject: DisciplineSubject, record: DisciplineRecord) => Promise<void>;
    /** The remembered ban or mute: undefined when there is none, null when it cannot be parsed. */
    readonly rememberedDiscipline: (subject: DisciplineSubject) => Promise<RelatedAction | null | undefined>;
    readonly forgetDiscipline: (subject: DisciplineSubject) => Promise<void>;
}

/** What mod-action alerts look up on Reddit. */
export interface ModerationLookups {
    /** Whether the user is on the subreddit's mod list, ignoring case. Rejects when the list cannot be fetched. */
    readonly isModerator: (username: string) => Promise<boolean>;
    /** The latest bans in the named subreddit's mod log, or the current subreddit's when none is named. */
    readonly recentBans: (subredditName: string | undefined) => Promise<readonly BanLogEntry[]>;
}

export interface ReportOptions {
    /** Send as a security alert: the action came from someone not on the mod list. */
    readonly unknownModerator: boolean;
    /** A channel to send to instead of the configured one; '' for none. */
    readonly channel: string;
}

export interface ModActionAlerts {
    /** Tells moderators about the action. Never rejects. */
    readonly report: (modAction: ModAction, options: ReportOptions) => Promise<void>;
}
