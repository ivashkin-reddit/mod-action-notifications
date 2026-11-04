import { slackChannel, type SlackMessage, type SlackSender } from '../../slack';
import type { ModActionAlerts } from '../application/ports';
import { ACTIVITY_SPIKE_ACTIONS, banDurationText, type ModAction, type ModActionTarget } from '../domain/modAction';
import { actionColor, actionName, actionTitle } from './actionCatalog';

export interface ModActionPresentation {
  includeModNote: boolean;
  /** Channel name without #, or '' for the webhook's own channel. */
  notificationChannel: string;
  /** Channel name without # for security alerts, or '' to use the notification channel. */
  alertChannel: string;
}

const CROWD_CONTROL_ACTIONS = new Set([
  'adjust_post_crowd_control_level',
  'enable_post_crowd_control_filter',
  'disable_post_crowd_control_filter',
]);

const PREVIEW_LENGTH = 200;

/** Mod-action alerts as Slack messages. */
export function createSlackModActionAlerts(send: SlackSender, presentation: ModActionPresentation): ModActionAlerts {
  return {
    async report(modAction, { unknownModerator, channel }) {
      const message = modActionMessage(modAction, presentation, unknownModerator);
      if (channel) {
        message.channel = slackChannel(channel);
      }
      await send(message);
    },
  };
}

function modActionMessage(modAction: ModAction, presentation: ModActionPresentation, unknownModerator: boolean): SlackMessage {
  const isComment = modAction.target?.isComment === true;
  const isCrowdControl = CROWD_CONTROL_ACTIONS.has(modAction.type);

  const lines: string[] = [
    unknownModerator ? '🚨 *Security Alert*' : '🔔 *Moderator Action*',
    `• *Action:* ${actionName(modAction.type, isComment)}`,
    `• *Moderator:* ${userLink(modAction.moderatorName)}`,
  ];

  if (modAction.target?.author) {
    lines.push(`• *Target:* ${userLink(modAction.target.author)}`);
  }
  const contentLink = contentLinkOf(modAction.target);
  if (contentLink) {
    lines.push(`• *Content:* ${contentLink}`);
  }
  if (modAction.target?.body) {
    const body = modAction.target.body;
    const preview = body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH)}...` : body;
    if (preview.trim().length > 0) {
      lines.push(`> ${preview}`);
    }
  }

  lines.push(`• *When:* ${timestamp(modAction.occurredAt)}`);

  if (modAction.type === 'banuser') {
    lines.push(`• *Ban Duration:* ${banDurationText(modAction)}`);
  }

  if (isCrowdControl) {
    if (modAction.details) {
      lines.push(`• *Level:* ${modAction.details}`);
    } else if (modAction.description) {
      lines.push(`• *Change:* ${modAction.description}`);
    }
  } else if (modAction.details) {
    lines.push(`• *Details:* ${modAction.details}`);
  }

  if (presentation.includeModNote && modAction.description && !isCrowdControl) {
    lines.push(`• *Mod Note:* ${modAction.description}`);
  }

  if ((modAction.type === 'unbanuser' || modAction.type === 'unmuteuser') && modAction.relatedAction) {
    const related = modAction.relatedAction;
    const pieces: string[] = [];
    if (related.moderatorName) {
      pieces.push(`Moderator ${userLink(related.moderatorName)}`);
    }
    if (related.occurredAt) {
      pieces.push(`on ${related.occurredAt.toISOString()}`);
    }
    const detailSnippet = related.details || related.description;
    if (detailSnippet) {
      pieces.push(`Details ${detailSnippet}`);
    }
    if (pieces.length > 0) {
      lines.push(`• *${modAction.type === 'unmuteuser' ? 'Related Mute' : 'Related Ban'}:* ${pieces.join(' • ')}`);
    }
  }

  const status: string[] = [];
  if (unknownModerator) {
    status.push('Unknown moderator (alert)');
  }
  if (modAction.isAutoModerator) {
    status.push('Origin AutoModerator');
  }
  const spike = modAction.activitySpike;
  if (spike && spike.count >= ACTIVITY_SPIKE_ACTIONS) {
    status.push(`Activity spike ${spike.count} actions / ${Math.round(spike.windowSeconds / 60)} min`);
  }
  if (status.length > 0) {
    lines.push(`• *Status:* ${status.join(' | ')}`);
  }

  const title = actionTitle(modAction.type, isComment);
  return {
    text: unknownModerator ? `🚨 SECURITY ALERT: ${title} by unknown moderator` : title,
    username: 'Reddit Mod Bot',
    icon_emoji: unknownModerator ? ':warning:' : ':shield:',
    attachments: [
      {
        color: unknownModerator ? '#ff0000' : actionColor(modAction.type),
        text: lines.join('\n'),
        mrkdwn_in: ['text', 'fields'],
        footer: 'Reddit Mod Action Bot',
        ts: Math.floor((modAction.occurredAt?.getTime() ?? Date.now()) / 1000),
      },
    ],
    channel: slackChannel(
      unknownModerator && presentation.alertChannel ? presentation.alertChannel : presentation.notificationChannel,
    ),
  };
}

/** A Slack link to the user's profile, without any u/ prefix; "Unknown" for a blank name. */
function userLink(username?: string | null): string {
  const trimmed = username?.trim();
  if (!trimmed) {
    return 'Unknown';
  }
  const normalized = trimmed.replace(/^u\//i, '');
  return `<https://www.reddit.com/u/${encodeURIComponent(normalized)}|u/${normalized}>`;
}

function contentLinkOf(target?: ModActionTarget | null): string | null {
  if (!target?.permalink) {
    return null;
  }
  const permalink = target.permalink.startsWith('http') ? target.permalink : `https://www.reddit.com${target.permalink}`;
  return `<${permalink}|${target.isComment ? 'View Comment' : 'View Post'}>`;
}

function timestamp(date: Date | undefined): string {
  if (!date) {
    return 'Unknown time';
  }
  try {
    return date.toISOString().replace('T', ' ').replace(/\..+/, ' UTC');
  } catch {
    return 'Unknown time';
  }
}
