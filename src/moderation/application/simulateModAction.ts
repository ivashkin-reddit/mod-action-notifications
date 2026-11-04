import { banLengthLabel, daysLabel, type ModAction } from '../domain/modAction';
import type { ModActionAlerts } from './ports';

/** A moderator's request to see how an action would be reported. */
export interface SimulationRequest {
  actionType: string;
  moderatorName?: string;
  targetUser?: string;
  includeModNote: boolean;
  modNote?: string;
  /** For a ban: days, 0 for permanent. */
  banDuration?: number;
  customDetails?: string;
  slackChannel?: string;
}

/**
 * Sends the alert a mod action like the one requested would produce, without touching stored data or checking
 * the mod list. Rejects when alerts have nowhere to go.
 */
export async function simulateModAction(
  request: SimulationRequest,
  config: { alertsConfigured: boolean },
  subredditName: string | undefined,
  alerts: ModActionAlerts,
): Promise<void> {
  if (!config.alertsConfigured) {
    throw new Error('Slack webhook URL is not configured');
  }

  const moderatorName = request.moderatorName ?? 'SimulationMod';
  const modAction: ModAction = {
    type: request.actionType,
    moderatorName,
    subredditName: subredditName ?? 'unknown',
    description: request.includeModNote ? (request.modNote ?? 'Simulation note') : undefined,
    details: request.customDetails,
    target: request.targetUser ? { author: request.targetUser, isComment: false } : undefined,
    occurredAt: new Date(),
    relatedAction: null,
    activitySpike: null,
    isAutoModerator: moderatorName.toLowerCase() === 'automoderator',
  };

  if (modAction.type === 'banuser') {
    const duration = request.banDuration ?? 0;
    if (Number.isFinite(duration) && duration >= 0) {
      modAction.banDuration = duration;
      modAction.banDurationLabel = banLengthLabel(duration);
    }
    if (!modAction.details && modAction.banDuration !== undefined && modAction.banDuration !== null) {
      modAction.details = modAction.banDuration === 0 ? 'permanent' : daysLabel(modAction.banDuration);
    }
  }

  await alerts.report(modAction, { unknownModerator: false, channel: request.slackChannel });
}
