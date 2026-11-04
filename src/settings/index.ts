import type { SettingsFormField, TriggerContext } from '@devvit/public-api';

/**
 * Installation settings: the form moderators fill in, and the validated configuration read from it.
 *
 * Devvit stores each installation's values under these setting names, so renaming one loses what moderators
 * saved. The form lists the settings in this order.
 */
export const settingsDefinitions: SettingsFormField[] = [
  {
    type: 'string',
    name: 'slackWebhookUrl',
    label: 'Slack Webhook URL',
    helpText: 'The Slack webhook URL to send mod action notifications to',
  },
  {
    type: 'select',
    name: 'enabledActions',
    label: 'Enabled Mod Actions',
    helpText: 'Select which mod actions to monitor',
    options: [
      { label: 'Remove Post', value: 'removelink' },
      { label: 'Remove Comment', value: 'removecomment' },
      { label: 'Spam Post', value: 'spamlink' },
      { label: 'Spam Comment', value: 'spamcomment' },
      { label: 'Approve Post', value: 'approvelink' },
      { label: 'Approve Comment', value: 'approvecomment' },
      { label: 'Ban User', value: 'banuser' },
      { label: 'Unban User', value: 'unbanuser' },
      { label: 'Lock Post', value: 'lock' },
      { label: 'Unlock Post', value: 'unlock' },
      { label: 'Sticky Post', value: 'sticky' },
      { label: 'Unsticky Post', value: 'unsticky' },
      { label: 'Edit Flair', value: 'editflair' },
      { label: 'Mute User', value: 'muteuser' },
      { label: 'Unmute User', value: 'unmuteuser' },
      { label: 'Distinguish Post/Comment', value: 'distinguish' },
      { label: 'Ignore Reports', value: 'ignorereports' },
      { label: 'Unignore Reports', value: 'unignorereports' },
      { label: 'Snooze Reports', value: 'snoozereports' },
      { label: 'Unsnooze Reports', value: 'unsnoozereports' },
      { label: 'Add Approved User', value: 'addcontributor' },
      { label: 'Remove Approved User', value: 'removecontributor' },
      { label: 'Invite Moderator', value: 'invitemoderator' },
      { label: 'Uninvite Moderator', value: 'uninvitemoderator' },
      { label: 'Accept Moderator Invite', value: 'acceptmoderatorinvite' },
      { label: 'Add Moderator', value: 'addmoderator' },
      { label: 'Remove Moderator', value: 'removemoderator' },
      { label: 'Edit Settings', value: 'editsettings' },
      { label: 'Adjust Crowd Control Level', value: 'adjust_post_crowd_control_level' },
      { label: 'Enable Crowd Control Filter', value: 'enable_post_crowd_control_filter' },
      { label: 'Disable Crowd Control Filter', value: 'disable_post_crowd_control_filter' },
    ],
    multiSelect: true,
    defaultValue: ['removelink', 'removecomment', 'spamlink', 'spamcomment', 'banuser', 'unbanuser'],
  },
  {
    type: 'string',
    name: 'excludedModerators',
    label: 'Excluded Moderators',
    helpText: 'Comma-separated list of moderator usernames to exclude (e.g., AutoModerator, BotName)',
  },
  {
    type: 'boolean',
    name: 'flagUnknownModerators',
    label: 'Flag Unknown Moderators',
    helpText: 'Send special alerts for mod actions by accounts not on the moderator list',
    defaultValue: true,
  },
  {
    type: 'boolean',
    name: 'includeModNote',
    label: 'Include Mod Note',
    helpText: 'Include moderator notes in Slack notifications',
    defaultValue: true,
  },
  {
    type: 'string',
    name: 'notificationChannel',
    label: 'Notification Channel',
    helpText: 'Slack channel name (optional, uses webhook default if empty)',
  },
  {
    type: 'string',
    name: 'alertChannel',
    label: 'Alert Channel',
    helpText: 'Separate channel for unknown moderator alerts (optional, uses main channel if empty)',
  },
  {
    type: 'number',
    name: 'modqueueThreshold',
    label: 'Modqueue Size Alert Threshold',
    helpText: 'Send alert when modqueue exceeds this many items (0 to disable)',
    defaultValue: 50,
  },
  {
    type: 'number',
    // Misspelt, but it is the stored setting name.
    name: 'unmoderagedAgeHours',
    label: 'Unmoderated Post Age Alert (Hours)',
    helpText: 'Alert when posts/comments remain unmoderated for this many hours (0 to disable)',
    defaultValue: 24,
  },
  {
    type: 'boolean',
    name: 'enableAutoModAlerts',
    label: 'Enable AutoModerator Slack Alerts',
    helpText: 'Send Slack notifications when AutoModerator performs moderation actions (disabled by default)',
    defaultValue: false,
  },
  {
    type: 'number',
    name: 'postDeletionUpvoteThreshold',
    label: 'Post Deletion Alert Threshold',
    helpText: 'Alert when deleted posts had at least this many upvotes (0 to disable)',
    defaultValue: 100,
  },
];

/** The installation's settings, validated. */
export interface AppConfig {
  /** An https URL, or '' when none is set or the one set is not https. */
  slackWebhookUrl: string;
  enabledActions: string[];
  /** Comma-separated usernames. */
  excludedModerators: string;
  flagUnknownModerators: boolean;
  includeModNote: boolean;
  /** A channel name without its leading #, or '' for the webhook's own channel. */
  notificationChannel: string;
  /** A channel name without its leading #, or ''. */
  alertChannel: string;
  /** 0 turns the queue-size alert off. */
  modqueueThreshold: number;
  /** 0 turns the unmoderated-age alert off. */
  unmoderatedAgeHours: number;
  enableAutoModAlerts: boolean;
  /** 0 turns deleted-post alerts off. */
  postDeletionUpvoteThreshold: number;
}

export type SettingsReader = Pick<TriggerContext['settings'], 'get'>;

/** What the app uses until it first reads the settings. */
const DEFAULT_CONFIG: AppConfig = {
  slackWebhookUrl: '',
  enabledActions: [],
  excludedModerators: '',
  flagUnknownModerators: true,
  includeModNote: true,
  notificationChannel: '',
  alertChannel: '',
  modqueueThreshold: 50,
  unmoderatedAgeHours: 24,
  enableAutoModAlerts: false,
  postDeletionUpvoteThreshold: 100,
};

/**
 * Returns a loader that reads and validates the settings each time it is called. When they cannot be read,
 * it logs and returns the configuration it last read (the defaults, before the first successful read).
 */
export function createConfigLoader(): (settings: SettingsReader) => Promise<AppConfig> {
  let config = DEFAULT_CONFIG;
  return async (settings) => {
    try {
      config = await readConfig(settings);
    } catch (error) {
      console.error('Failed to load configuration - check settings format and values:', error);
    }
    return config;
  };
}

async function readConfig(settings: SettingsReader): Promise<AppConfig> {
  const rawWebhookUrl = await settings.get('slackWebhookUrl');
  const rawEnabledActions = await settings.get('enabledActions');
  const rawExcludedModerators = await settings.get('excludedModerators');
  const rawFlagUnknown = await settings.get('flagUnknownModerators');
  const rawIncludeNote = await settings.get('includeModNote');
  const rawNotificationChannel = await settings.get('notificationChannel');
  const rawAlertChannel = await settings.get('alertChannel');
  const rawModqueueThreshold = await settings.get('modqueueThreshold');
  const rawUnmoderatedAgeHours = await settings.get('unmoderagedAgeHours');
  const rawEnableAutoModAlerts = await settings.get('enableAutoModAlerts');
  const rawPostDeletionUpvoteThreshold = await settings.get('postDeletionUpvoteThreshold');

  const webhookUrl = typeof rawWebhookUrl === 'string' ? rawWebhookUrl.trim() : '';
  if (webhookUrl && !webhookUrl.startsWith('https://')) {
    console.error('Invalid Slack webhook URL: must start with https://');
  }

  return {
    slackWebhookUrl: webhookUrl.startsWith('https://') ? webhookUrl : '',
    enabledActions: Array.isArray(rawEnabledActions) ? (rawEnabledActions as string[]) : [],
    excludedModerators: typeof rawExcludedModerators === 'string' ? rawExcludedModerators : '',
    flagUnknownModerators: typeof rawFlagUnknown === 'boolean' ? rawFlagUnknown : true,
    includeModNote: typeof rawIncludeNote === 'boolean' ? rawIncludeNote : true,
    notificationChannel: channelName(rawNotificationChannel),
    alertChannel: channelName(rawAlertChannel),
    modqueueThreshold: nonNegativeInteger(rawModqueueThreshold, 50),
    unmoderatedAgeHours: nonNegativeInteger(rawUnmoderatedAgeHours, 24),
    enableAutoModAlerts: typeof rawEnableAutoModAlerts === 'boolean' ? rawEnableAutoModAlerts : false,
    postDeletionUpvoteThreshold: nonNegativeInteger(rawPostDeletionUpvoteThreshold, 100),
  };
}

/** A trimmed channel name without leading #s, or ''. */
function channelName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/^#+/, '');
}

/** A whole number of at least 0, read from a number or numeric text; `fallback` for anything else. */
function nonNegativeInteger(value: unknown, fallback: number): number {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string') {
    parsed = parseInt(value, 10);
    if (isNaN(parsed)) return fallback;
  } else {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}
