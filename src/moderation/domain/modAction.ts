/** What a mod action was done to. */
export interface ModActionTarget {
  /** The username of the target, or of the content's author. */
  author?: string | null;
  permalink?: string | null;
  /** The content's text, or a post's title when it has none. */
  body?: string | null;
  isComment?: boolean;
}

/** For an unban or unmute: the ban or mute it lifts. */
export interface RelatedAction {
  type?: string;
  moderatorName?: string;
  occurredAt?: Date;
  description?: string;
  details?: string;
}

/** A burst of actions by one moderator. */
export interface ActivitySpike {
  count: number;
  windowSeconds: number;
}

/** A moderator's action on the subreddit. */
export interface ModAction {
  id?: string;
  /** Reddit's action type, such as removelink or banuser. */
  type: string;
  moderatorName?: string;
  subredditName?: string;
  target?: ModActionTarget | null;
  /** The mod note or reason. */
  description?: string;
  details?: string;
  occurredAt?: Date;
  isAutoModerator: boolean;
  /** For a ban: its length in days, 0 when permanent. */
  banDuration?: number | null;
  /** For a ban: how its length reads, when not as a number of days. */
  banDurationLabel?: string | null;
  relatedAction: RelatedAction | null;
  activitySpike: ActivitySpike | null;
}

// --- Who is notified about -------------------------------------------------------------------------------

/** Whether the moderator is in the comma-separated exclusion list, ignoring case and spaces. */
export function isExcludedModerator(moderatorName: string, excludedModerators: string): boolean {
  if (!excludedModerators) return false;
  const excluded = excludedModerators
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name.length > 0);
  return excluded.includes(moderatorName.toLowerCase());
}

// --- Activity spikes -------------------------------------------------------------------------------------

/** Actions within a minute of each other count toward a spike. */
const ACTIVITY_WINDOW_MS = 60_000;
/** A moderator's fifth action within the window is a spike. */
export const ACTIVITY_SPIKE_ACTIONS = 5;
/** At most this many action times are kept per moderator. */
const MAX_TRACKED_ACTIONS = 100;

/** A moderator's recent action times after one more action at `now`. */
export function withActionAt(previousTimes: number[], now: number): number[] {
  const times = previousTimes.filter((time) => now - time <= ACTIVITY_WINDOW_MS);
  times.push(now);
  return times.length > MAX_TRACKED_ACTIONS ? times.slice(-MAX_TRACKED_ACTIONS) : times;
}

export function activitySpike(actionTimes: number[]): ActivitySpike | null {
  return actionTimes.length >= ACTIVITY_SPIKE_ACTIONS
    ? { count: actionTimes.length, windowSeconds: Math.floor(ACTIVITY_WINDOW_MS / 1000) }
    : null;
}

// --- Bans and mutes --------------------------------------------------------------------------------------

export type DisciplineKind = 'ban' | 'mute';

/** A ban or mute, remembered so the unban or unmute that lifts it can mention it. */
export interface DisciplineRecord {
  moderatorName: string;
  occurredAt: number;
  description: string | null;
  details: string | null;
}

/** Bans and mutes are remembered; unbans and unmutes recall the ban or mute they lift. */
export function disciplineStep(actionType: string): { kind: DisciplineKind; step: 'remember' | 'recall' } | null {
  switch (actionType) {
    case 'banuser':
      return { kind: 'ban', step: 'remember' };
    case 'muteuser':
      return { kind: 'mute', step: 'remember' };
    case 'unbanuser':
      return { kind: 'ban', step: 'recall' };
    case 'unmuteuser':
      return { kind: 'mute', step: 'recall' };
    default:
      return null;
  }
}

export function disciplineRecordOf(modAction: ModAction): DisciplineRecord {
  return {
    moderatorName: modAction.moderatorName ?? 'Unknown',
    occurredAt: modAction.occurredAt?.getTime() ?? Date.now(),
    description: modAction.description ?? null,
    details: modAction.details ?? null,
  };
}

// --- Ban durations ---------------------------------------------------------------------------------------

export function daysLabel(days: number): string {
  return `${days} day${days === 1 ? '' : 's'}`;
}

export function banLengthLabel(days: number): string {
  return days === 0 ? 'Permanent Ban' : daysLabel(days);
}

/**
 * Reads a ban length from free text: "permanent" anywhere, or a number of days ("7 day", "7d").
 * The pattern does not match a plural "days", so such text is kept as the label, verbatim.
 */
export function parseBanDuration(rawDetails?: string | null): { days: number | null; label: string | null } {
  if (!rawDetails) {
    return { days: null, label: null };
  }
  const normalized = rawDetails.trim();
  if (normalized.length === 0) {
    return { days: null, label: null };
  }
  if (normalized.toLowerCase().includes('permanent')) {
    return { days: 0, label: 'Permanent Ban' };
  }
  const dayMatch = normalized.match(/(\d+)\s*(?:day|d)\b/i);
  if (dayMatch) {
    const parsedDays = parseInt(dayMatch[1], 10);
    if (!Number.isNaN(parsedDays)) {
      return { days: parsedDays, label: daysLabel(parsedDays) };
    }
  }
  return { days: null, label: normalized };
}

/** A ban's length from a numeric duration when there is one, else from its details, else from its description. */
export function banDurationFrom(
  numericDuration: unknown,
  details: string | undefined,
  description: string | undefined,
): Pick<ModAction, 'banDuration' | 'banDurationLabel'> {
  const detailsInfo = parseBanDuration(details);
  const descriptionInfo = details ? { days: null, label: null } : parseBanDuration(description);

  if (typeof numericDuration === 'number' && !Number.isNaN(numericDuration)) {
    return { banDuration: numericDuration, banDurationLabel: banLengthLabel(numericDuration) };
  }
  if (detailsInfo.days !== null) {
    return { banDuration: detailsInfo.days, banDurationLabel: detailsInfo.label || undefined };
  }
  if (descriptionInfo.days !== null) {
    return { banDuration: descriptionInfo.days, banDurationLabel: descriptionInfo.label || undefined };
  }
  return { banDuration: undefined, banDurationLabel: detailsInfo.label || descriptionInfo.label || undefined };
}

/** Whether a ban says anything about its length; when not, the mod log is consulted. */
export function hasBanDurationMetadata(modAction: ModAction): boolean {
  return Boolean(
    (modAction.banDuration !== undefined && modAction.banDuration !== null) ||
      (modAction.banDurationLabel && modAction.banDurationLabel.trim().length > 0) ||
      (modAction.details && modAction.details.trim().length > 0),
  );
}

/** How a ban's length reads in an alert. */
export function banDurationText(modAction: ModAction): string {
  let text: string | null = null;
  if (modAction.banDuration !== undefined && modAction.banDuration !== null) {
    text = banLengthLabel(modAction.banDuration);
  }
  if (!text && modAction.banDurationLabel) {
    text = modAction.banDurationLabel;
  }
  if (!text && modAction.details) {
    const trimmedDetails = modAction.details.trim();
    if (trimmedDetails.length > 0) {
      text = trimmedDetails;
    }
  }
  if (!text && modAction.description) {
    text = parseBanDuration(modAction.description).label;
  }
  return text || 'Unknown Duration';
}

// --- The mod log -----------------------------------------------------------------------------------------

/** A ban in the subreddit's mod log. */
export interface BanLogEntry {
  id: string;
  moderatorName?: string;
  createdAt: Date;
  details?: string;
  description?: string;
  targetAuthor?: string;
}

/** Banning moderators and banned users are matched within two minutes of the action. */
const BAN_LOG_MATCH_WINDOW_MS = 2 * 60 * 1000;

/**
 * The first entry describing this ban: the one with its ID; else one for the same user by the same moderator
 * (or by anyone, when the action names no moderator); else one by the same moderator when the action names no
 * user; else one within two minutes of it for the same user (or for anyone, when the action names no user).
 */
export function matchBanLogEntry(entries: BanLogEntry[], modAction: ModAction): BanLogEntry | undefined {
  const target = modAction.target?.author?.toLowerCase() ?? null;
  const moderator = modAction.moderatorName?.toLowerCase() ?? null;
  const occurredAt = modAction.occurredAt?.getTime() ?? null;

  return entries.find((entry) => {
    if (!entry) return false;
    if (modAction.id && entry.id === modAction.id) {
      return true;
    }

    const entryTarget = entry.targetAuthor?.toLowerCase() ?? null;
    const entryModerator = entry.moderatorName?.toLowerCase();
    if (target && entryTarget && entryTarget === target && (!moderator || entryModerator === moderator)) {
      return true;
    }
    if (moderator && entryModerator === moderator && !target) {
      return true;
    }
    if (occurredAt && Math.abs(entry.createdAt.getTime() - occurredAt) <= BAN_LOG_MATCH_WINDOW_MS) {
      return !target || entryTarget === target;
    }
    return false;
  });
}

/** The ban, completed from its mod log entry: details and reason it lacks, and the length the entry gives. */
export function withBanLogEntry(modAction: ModAction, entry: BanLogEntry): ModAction {
  const completed: ModAction = { ...modAction };
  if (!completed.details && entry.details) {
    completed.details = entry.details;
  }
  if (!completed.description && entry.description) {
    completed.description = entry.description;
  }
  const parsed = parseBanDuration(entry.details ?? entry.description ?? null);
  if (parsed.days !== null) {
    completed.banDuration = parsed.days;
    completed.banDurationLabel = parsed.label ?? completed.banDurationLabel;
  } else if (!completed.banDurationLabel && parsed.label) {
    completed.banDurationLabel = parsed.label;
  }
  return completed;
}
