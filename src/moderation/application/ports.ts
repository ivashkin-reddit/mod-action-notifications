import type { BanLogEntry, DisciplineKind, DisciplineRecord, ModAction, RelatedAction } from '../domain/modAction';

/** What mod-action alerts keep between actions. Each method rejects when storage fails. */
export interface ModerationRecords {
  /** The moderator's recent action times (ms since the epoch); [] when none are kept or they cannot be parsed. */
  recentActionTimes(subredditName: string, moderatorName: string): Promise<number[]>;
  /** Keeps the moderator's recent action times for an hour. */
  keepRecentActionTimes(subredditName: string, moderatorName: string, times: number[]): Promise<void>;
  /** Remembers a ban or mute of the user for 90 days, replacing one already remembered. */
  rememberDiscipline(kind: DisciplineKind, subredditName: string, username: string, record: DisciplineRecord): Promise<void>;
  /** The remembered ban or mute of the user: undefined when there is none, null when it cannot be parsed. */
  rememberedDiscipline(kind: DisciplineKind, subredditName: string, username: string): Promise<RelatedAction | null | undefined>;
  forgetDiscipline(kind: DisciplineKind, subredditName: string, username: string): Promise<void>;
}

/** What mod-action alerts look up on Reddit. */
export interface ModerationLookups {
  /** Whether the user is on the subreddit's mod list, ignoring case. Rejects when the list cannot be fetched. */
  isModerator(username: string): Promise<boolean>;
  /** The latest bans in the named subreddit's mod log, or the current subreddit's when none is named. */
  recentBans(subredditName: string | undefined): Promise<BanLogEntry[]>;
}

export interface ModActionAlerts {
  /**
   * Tells moderators about the action: as a security alert when it came from someone not on the mod list, and
   * in `channel` when one is given. Never rejects.
   */
  report(modAction: ModAction, options: { unknownModerator: boolean; channel?: string }): Promise<void>;
}
