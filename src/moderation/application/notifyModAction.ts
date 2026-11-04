import {
  activitySpike,
  disciplineRecordOf,
  disciplineStep,
  hasBanDurationMetadata,
  isExcludedModerator,
  matchBanLogEntry,
  withActionAt,
  withBanLogEntry,
  type ActivitySpike,
  type DisciplineKind,
  type ModAction,
  type RelatedAction,
} from '../domain/modAction';
import type { ModActionAlerts, ModerationLookups, ModerationRecords } from './ports';

export interface ModerationConfig {
  /** Whether alerts have somewhere to go; without, mod actions are ignored entirely. */
  alertsConfigured: boolean;
  enabledActions: string[];
  /** Comma-separated usernames whose actions are not sent. */
  excludedModerators: string;
  /** Send actions by users not on the mod list as security alerts. */
  flagUnknownModerators: boolean;
  enableAutoModAlerts: boolean;
}

export interface ModerationPorts {
  records: ModerationRecords;
  lookups: ModerationLookups;
  alerts: ModActionAlerts;
}

/**
 * Tells moderators about a mod action. Every action, sent or not, is first completed from the mod log (a ban
 * without a length), remembered or matched against what it lifts (bans and mutes), and counted toward its
 * moderator's activity (except AutoModerator's). It is then sent when its type is enabled, its moderator is
 * not excluded, and it is not AutoModerator's while AutoModerator alerts are off.
 */
export async function notifyModAction(action: ModAction, config: ModerationConfig, ports: ModerationPorts): Promise<void> {
  if (!config.alertsConfigured) {
    console.error('Slack webhook URL not configured - skipping notification');
    return;
  }

  let modAction = action;
  if (modAction.type === 'banuser' && !hasBanDurationMetadata(modAction)) {
    modAction = await withBanFromModLog(modAction, ports.lookups);
  }

  const actionType = modAction.type || 'unknown';
  const discipline = disciplineStep(actionType);
  if (discipline?.step === 'remember') {
    await rememberDiscipline(discipline.kind, modAction, ports.records);
  } else if (discipline?.step === 'recall') {
    modAction = { ...modAction, relatedAction: await recallDiscipline(discipline.kind, modAction, ports.records) };
  }

  if (!modAction.isAutoModerator) {
    modAction = { ...modAction, activitySpike: await trackActivity(modAction, ports.records) };
  }

  if (!config.enabledActions.includes(actionType)) {
    return;
  }

  const moderatorName = modAction.moderatorName || 'Unknown';
  if (isExcludedModerator(moderatorName, config.excludedModerators)) {
    return;
  }

  let unknownModerator = false;
  if (config.flagUnknownModerators && moderatorName !== 'Unknown' && !(await isOnModList(moderatorName, ports.lookups))) {
    unknownModerator = true;
    console.warn('Mod action by unknown moderator', { moderator: moderatorName, action: actionType });
  }

  if (!config.enableAutoModAlerts && modAction.isAutoModerator) {
    return;
  }

  await ports.alerts.report(modAction, { unknownModerator });
}

/** The ban, completed from the mod log when an entry matches; unchanged when none does or the log cannot be read. */
async function withBanFromModLog(modAction: ModAction, lookups: ModerationLookups): Promise<ModAction> {
  try {
    const entry = matchBanLogEntry(await lookups.recentBans(modAction.subredditName), modAction);
    return entry ? withBanLogEntry(modAction, entry) : modAction;
  } catch {
    return modAction;
  }
}

async function rememberDiscipline(kind: DisciplineKind, modAction: ModAction, records: ModerationRecords): Promise<void> {
  const username = modAction.target?.author ?? undefined;
  if (!modAction.subredditName || !username) {
    return;
  }
  try {
    await records.rememberDiscipline(kind, modAction.subredditName, username, disciplineRecordOf(modAction));
  } catch {
    // Only the matching unban or unmute loses the reminder.
  }
}

/** The ban or mute the action lifts, forgotten once recalled; null when none is remembered. */
async function recallDiscipline(
  kind: DisciplineKind,
  modAction: ModAction,
  records: ModerationRecords,
): Promise<RelatedAction | null> {
  const username = modAction.target?.author ?? undefined;
  if (!modAction.subredditName || !username) {
    return null;
  }
  let related: RelatedAction | null = null;
  try {
    const remembered = await records.rememberedDiscipline(kind, modAction.subredditName, username);
    if (remembered === undefined) {
      return null;
    }
    related = remembered;
    await records.forgetDiscipline(kind, modAction.subredditName, username);
  } catch {
    // The alert goes out without the reminder.
  }
  return related;
}

/** Counts the action toward its moderator's activity; the spike it completes, if any. */
async function trackActivity(modAction: ModAction, records: ModerationRecords): Promise<ActivitySpike | null> {
  if (!modAction.moderatorName || !modAction.subredditName) {
    return null;
  }
  let spike: ActivitySpike | null = null;
  try {
    const now = Date.now();
    const times = withActionAt(await records.recentActionTimes(modAction.subredditName, modAction.moderatorName), now);
    spike = activitySpike(times);
    await records.keepRecentActionTimes(modAction.subredditName, modAction.moderatorName, times);
  } catch {
    // Activity tracking is best effort.
  }
  return spike;
}

/** Whether the user is on the mod list; when the list cannot be fetched, assume so rather than raise a false alarm. */
async function isOnModList(moderatorName: string, lookups: ModerationLookups): Promise<boolean> {
  try {
    return await lookups.isModerator(moderatorName);
  } catch (error) {
    console.error('Failed to fetch moderator list:', error);
    return true;
  }
}
