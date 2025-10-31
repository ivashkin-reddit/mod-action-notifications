import { Devvit, TriggerContext } from '@devvit/public-api';

// Configure Devvit
Devvit.configure({
  redditAPI: true,
  http: {
    domains: ['hooks.slack.com']
  },
  redis: true,
});

// Add settings configuration
Devvit.addSettings([
  {
    type: 'string',
    name: 'slackWebhookUrl',
    label: 'Slack Webhook URL',
    helpText: 'The Slack webhook URL to send mod action notifications to'
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
      { label: 'Disable Crowd Control Filter', value: 'disable_post_crowd_control_filter' }
    ],
    multiSelect: true,
    defaultValue: ['removelink', 'removecomment', 'spamlink', 'spamcomment', 'banuser', 'unbanuser']
  },
  {
    type: 'string',
    name: 'excludedModerators',
    label: 'Excluded Moderators',
    helpText: 'Comma-separated list of moderator usernames to exclude (e.g., AutoModerator, BotName)'
  },
  {
    type: 'boolean',
    name: 'flagUnknownModerators',
    label: 'Flag Unknown Moderators',
    helpText: 'Send special alerts for mod actions by accounts not on the moderator list',
    defaultValue: true
  },
  {
    type: 'boolean',
    name: 'includeModNote',
    label: 'Include Mod Note',
    helpText: 'Include moderator notes in Slack notifications',
    defaultValue: true
  },
  {
    type: 'string',
    name: 'notificationChannel',
    label: 'Notification Channel',
    helpText: 'Slack channel name (optional, uses webhook default if empty)'
  },
  {
    type: 'string',
    name: 'alertChannel',
    label: 'Alert Channel',
    helpText: 'Separate channel for unknown moderator alerts (optional, uses main channel if empty)'
  },
  {
    type: 'number',
    name: 'modqueueThreshold',
    label: 'Modqueue Size Alert Threshold',
    helpText: 'Send alert when modqueue exceeds this many items (0 to disable)',
    defaultValue: 50
  },
  {
    type: 'number',
    name: 'unmoderagedAgeHours',
    label: 'Unmoderated Post Age Alert (Hours)',
    helpText: 'Alert when posts/comments remain unmoderated for this many hours (0 to disable)',
    defaultValue: 24
  },
  {
    type: 'boolean',
    name: 'enableAutoModAlerts',
    label: 'Enable AutoModerator Slack Alerts',
    helpText: 'Send Slack notifications when AutoModerator performs moderation actions (disabled by default)',
    defaultValue: false
  },
  {
    type: 'number',
    name: 'postDeletionUpvoteThreshold',
    label: 'Post Deletion Alert Threshold',
    helpText: 'Alert when deleted posts had at least this many upvotes (0 to disable)',
    defaultValue: 100
  }
]);

type ActionType = string;

interface SlackMessageField {
  title: string;
  value: string;
  short: boolean;
}

interface SlackMessageAttachment {
  color: string;
  text?: string;
  fields?: SlackMessageField[];
  footer?: string;
  ts?: number;
  mrkdwn_in?: string[];
}

interface SlackMessage {
  text: string;
  username?: string;
  icon_emoji?: string;
  channel?: string;
  attachments?: SlackMessageAttachment[];
}

interface RapidFireAlert {
  count: number;
  windowSeconds: number;
}

interface RelatedAction {
  type?: ActionType;
  moderatorName?: string;
  occurredAt?: Date;
  description?: string;
  details?: string;
}

interface ModActionTarget {
  id?: string | null;
  name?: string | null;
  author?: string | null;
  permalink?: string | null;
  body?: string | null;
  title?: string | null;
  isComment?: boolean;
  score?: number | null;
  upvoteRatio?: number | null;
}

interface ModActionData {
  id?: string | null;
  type: ActionType;
  subtype?: string | null;
  moderatorName?: string;
  subredditName?: string;
  target?: ModActionTarget;
  description?: string;
  details?: string;
  occurredAt?: Date;
  relatedAction: RelatedAction | null;
  isAutoModerator?: boolean;
  banDuration?: number | null;
  banDurationLabel?: string | null;
  rapidFireAlert: RapidFireAlert | null;
}

interface BotConfig {
  slackWebhookUrl: string;
  enabledActions: ActionType[];
  excludedModerators: string;
  flagUnknownModerators: boolean;
  includeModNote: boolean;
  notificationChannel: string;
  alertChannel: string;
  modqueueThreshold: number;
  unmoderagedAgeHours: number;
  enableAutoModAlerts: boolean;
  postDeletionUpvoteThreshold: number;
}

interface SimulateActionFormValues {
  actionType: ActionType;
  moderatorName?: string;
  targetUser?: string;
  includeModNote: boolean;
  modNote?: string;
  banDuration?: number;
  customDetails?: string;
  slackChannel?: string;
}

/**
 * Reddit Mod Action Slack Bot
 * 
 * REDIS KEY SCHEMA DOCUMENTATION:
 * 
 * Job Management (No TTL - persistent):
 * - modqueue_monitor_job_id: Stores the scheduler job ID for modqueue monitoring
 * 
 * Discipline Context (TTL: 90 days):
 * - mod_actions:discipline:{ban|mute}:{subreddit}:{username}: Stores ban/mute details for pairing with unban/unmute
 *   Value: JSON { type, moderatorName, duration?, reason? }
 * 
 * Post Score Cache (TTL: 7 days):
 * - post_score:{postId}: Stores post metadata for deletion tracking
 *   Value: JSON { score, title, authorName, permalink, subredditName }
 *   Populated on PostCreate/PostUpdate when score >= 50% of threshold
 * 
 * Moderator Activity Tracking (TTL: 1 hour):
 * - mod_actions:moderator_activity:{subreddit}:{moderator}: Sorted set of recent action timestamps
 *   Used for rapid-fire detection (5+ actions within 1 minute)
 * 
 * Alert Throttling (TTL: 1 hour):
 * - mod_actions:throttle:{alertType}: Timestamp of last alert sent
 *   Types: 'modqueue_size', 'modqueue_unmoderated'
 *   Prevents spam by allowing only one alert per hour
 * 
 * Scheduler Failure Tracking (TTL: 1 hour):
 * - scheduler_failure_count: Counter for consecutive modqueue monitoring failures
 *   Incremented on each failure, reset on success or after sending alert
 *   Alerts to Slack after 3 consecutive failures
 * 
 * Alert History (TTL aligns with feature needs):
 * - mod_actions:throttle:{alertType}: Timestamp of last alert sent (1 hour TTL)
 */
class ModActionSlackBot {
  private static readonly MODQUEUE_MONITOR_JOB_ID_KEY = 'modqueue_monitor_job_id';
  private static readonly DISCIPLINE_CONTEXT_TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
  private static readonly POST_SCORE_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days (posts older than this unlikely to be deleted)
  private static readonly RAPID_FIRE_WINDOW_MS = 60_000; // 1 minute window
  private static readonly RAPID_FIRE_THRESHOLD = 5; // Actions required within window to trigger alert
  private static readonly RAPID_FIRE_TTL_SECONDS = 60 * 60; // Keep moderator activity data for 1 hour
  private static readonly MODQUEUE_ALERT_THROTTLE_SECONDS = 60 * 60; // Only alert once per hour for modqueue issues
  private static readonly SCHEDULER_FAILURE_THRESHOLD = 3; // Alert after this many consecutive failures
  private static readonly SCHEDULER_FAILURE_KEY = 'scheduler_failure_count';
  private static readonly MODERATOR_CACHE_TTL_MS = 5 * 60 * 1000; // Cache moderator list for 5 minutes
  private static readonly RAPID_FIRE_MAX_TIMESTAMPS = 100; // Safety cap for timestamp array
  private static readonly SLACK_RETRY_MAX_ATTEMPTS = 3; // Maximum retry attempts for Slack webhook
  private static readonly SLACK_RETRY_BASE_DELAY_MS = 1000; // Base delay for exponential backoff (1 second)
  private static readonly SCHEDULER_FAILURE_TTL_SECONDS = 3600; // 1 hour TTL for failure counter

  private config: BotConfig;
  private moderatorCache: {
    subreddit: string;
    fetchedAt: number;
    moderators: Set<string>;
  } | null;

  constructor() {
    this.config = {
      slackWebhookUrl: '',
      enabledActions: [],
      excludedModerators: '',
      flagUnknownModerators: true,
      includeModNote: true,
      notificationChannel: '',
      alertChannel: '',
      modqueueThreshold: 50,
      unmoderagedAgeHours: 24,
      enableAutoModAlerts: false,
      postDeletionUpvoteThreshold: 100
    };
    this.moderatorCache = null;
  }

  /**
   * Check if a moderator should be excluded from notifications
   */
  private isModeratorExcluded(moderatorName: string): boolean {
    if (!this.config.excludedModerators) return false;
    
    const excludedList = this.config.excludedModerators
      .split(',')
      .map(name => name.trim().toLowerCase())
      .filter(name => name.length > 0);
    
    return excludedList.includes(moderatorName.toLowerCase());
  }

  /**
   * Check if a moderator is in the official moderator list
   */
  private async isOfficialModerator(moderatorName: string, context: TriggerContext): Promise<boolean> {
    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
  const subredditName = subreddit.name ?? 'unknown';
      const normalizedModerator = moderatorName.toLowerCase();
      const now = Date.now();

      if (
        this.moderatorCache &&
        this.moderatorCache.subreddit === subredditName &&
        now - this.moderatorCache.fetchedAt < ModActionSlackBot.MODERATOR_CACHE_TTL_MS
      ) {
        return this.moderatorCache.moderators.has(normalizedModerator);
      }

      const mods = await subreddit.getModerators();
      const modArray = await mods.all();
      const modSet = new Set(modArray.map((mod) => mod.username.toLowerCase()));

      this.moderatorCache = {
        subreddit: subredditName,
        fetchedAt: now,
        moderators: modSet,
      };

      return modSet.has(normalizedModerator);
    } catch (error) {
      console.error('Failed to fetch moderator list:', error);
      // If we can't fetch the mod list, assume they are official to avoid false positives
      return true;
    }
  }

  /**
   * Load configuration from Devvit settings
   */
  private async loadConfig(context: TriggerContext): Promise<void> {
    try {
      // Fetch all settings with type validation
      const rawWebhookUrl = await context.settings.get('slackWebhookUrl');
      const rawEnabledActions = await context.settings.get('enabledActions');
      const rawExcludedModerators = await context.settings.get('excludedModerators');
      const rawFlagUnknown = await context.settings.get('flagUnknownModerators');
      const rawIncludeNote = await context.settings.get('includeModNote');
      const rawNotificationChannel = await context.settings.get('notificationChannel');
      const rawAlertChannel = await context.settings.get('alertChannel');
      const rawModqueueThreshold = await context.settings.get('modqueueThreshold');
      const rawUnmoderagedAgeHours = await context.settings.get('unmoderagedAgeHours');
      const rawEnableAutoModAlerts = await context.settings.get('enableAutoModAlerts');
  const rawPostDeletionUpvoteThreshold = await context.settings.get('postDeletionUpvoteThreshold');

      // Type-safe assignments with validation
      const rawWebhookUrlStr = typeof rawWebhookUrl === 'string' ? rawWebhookUrl.trim() : '';
      
      // Validate webhook URL format
      if (rawWebhookUrlStr && !rawWebhookUrlStr.startsWith('https://')) {
        console.error('Invalid Slack webhook URL: must start with https://');
        this.config.slackWebhookUrl = '';
      } else {
        this.config.slackWebhookUrl = rawWebhookUrlStr;
      }
      
      this.config.enabledActions = Array.isArray(rawEnabledActions) ? rawEnabledActions : [];
      this.config.excludedModerators = typeof rawExcludedModerators === 'string' ? rawExcludedModerators : '';
      this.config.flagUnknownModerators = typeof rawFlagUnknown === 'boolean' ? rawFlagUnknown : true;
      this.config.includeModNote = typeof rawIncludeNote === 'boolean' ? rawIncludeNote : true;
      
      // Validate and normalize channel names
      const normalizeChannel = (channel: unknown): string => {
        if (typeof channel !== 'string') return '';
        const trimmed = channel.trim();
        if (!trimmed) return '';
        // Remove multiple # prefixes if present
        return trimmed.replace(/^#+/, '');
      };
      
      this.config.notificationChannel = normalizeChannel(rawNotificationChannel);
      this.config.alertChannel = normalizeChannel(rawAlertChannel);
      
      // Number settings - parse from string if needed and ensure non-negative
      const parsePositiveInt = (value: unknown, defaultValue: number): number => {
        let parsed: number;
        if (typeof value === 'number') {
          parsed = value;
        } else if (typeof value === 'string') {
          parsed = parseInt(value, 10);
          if (isNaN(parsed)) return defaultValue;
        } else {
          return defaultValue;
        }
        // Ensure non-negative
        return Math.max(0, Math.floor(parsed));
      };
      
    this.config.modqueueThreshold = parsePositiveInt(rawModqueueThreshold, 50);
    this.config.unmoderagedAgeHours = parsePositiveInt(rawUnmoderagedAgeHours, 24);
    this.config.postDeletionUpvoteThreshold = parsePositiveInt(rawPostDeletionUpvoteThreshold, 100);
    this.config.enableAutoModAlerts = typeof rawEnableAutoModAlerts === 'boolean' ? rawEnableAutoModAlerts : false;

    } catch (error) {
      console.error('Failed to load configuration - check settings format and values:', error);
    }
  }

  async setupModqueueMonitoring(context: TriggerContext): Promise<{ enabled: boolean; jobId?: string }> {
    await this.loadConfig(context);
    const jobIdKey = ModActionSlackBot.MODQUEUE_MONITOR_JOB_ID_KEY;
    const redis = context.redis;

    const threshold = this.config.modqueueThreshold;
    const unmoderagedHours = this.config.unmoderagedAgeHours;

    // Check if monitoring should be enabled (either threshold is active)
    const shouldEnable = threshold > 0 || unmoderagedHours > 0;

    const existingJobId = await redis.get(jobIdKey);

    if (!shouldEnable) {
      if (existingJobId) {
        try {
          await context.scheduler.cancelJob(existingJobId);
        } catch {
          // Job already cancelled or doesn't exist
        }
        await redis.del(jobIdKey);
      }
      return { enabled: false };
    }

    if (existingJobId) {
      return { enabled: true, jobId: existingJobId };
    }

    try {
      // Run every 15 minutes
      const jobId = await context.scheduler.runJob({
        name: 'modqueueMonitor',
        cron: '*/15 * * * *',
      });
      await redis.set(jobIdKey, jobId);
      return { enabled: true, jobId };
    } catch (scheduleError) {
      console.error('Failed to schedule modqueue monitor job', scheduleError);
      throw scheduleError;
    }
  }

  async getStatusSummary(context: TriggerContext): Promise<string> {
    await this.loadConfig(context);
    const lines: string[] = [];

    lines.push(`Modqueue Monitoring: ${this.config.modqueueThreshold > 0 || this.config.unmoderagedAgeHours > 0 ? 'ON' : 'OFF'}`);
    lines.push(`Slack Webhook: ${this.config.slackWebhookUrl ? 'Configured' : 'Missing'}`);

    try {
      const redis = context.redis;
      const modqueueJobIdBuffer = await redis.get(ModActionSlackBot.MODQUEUE_MONITOR_JOB_ID_KEY);
      if (!modqueueJobIdBuffer) {
        lines.push('Modqueue Monitor: Not scheduled');
      } else {
        const jobId = modqueueJobIdBuffer;
        try {
          const jobs = await context.scheduler.listJobs();
          const job = jobs.find((entry) => entry.id === jobId);
          if (job) {
            if ('cron' in job && job.cron) {
              lines.push(`Modqueue Monitor: Active (cron ${job.cron})`);
            } else {
              lines.push('Modqueue Monitor: Active');
            }
          } else {
            lines.push('Modqueue Monitor: Stale reference');
          }
        } catch {
          lines.push('Modqueue Monitor: Unknown');
        }
      }
    } catch {
      lines.push('Job Status: Unavailable');
    }

    return lines.join('\n');
  }

  async simulateModAction(rawValues: Record<string, unknown>, context: TriggerContext): Promise<void> {
    await this.loadConfig(context);

    if (!this.config.slackWebhookUrl) {
      throw new Error('Slack webhook URL is not configured');
    }

    const actionTypeRaw = rawValues.actionType;
    let actionType = 'removelink';
    if (typeof actionTypeRaw === 'string') {
      actionType = actionTypeRaw;
    } else if (Array.isArray(actionTypeRaw) && actionTypeRaw.length > 0) {
      actionType = String(actionTypeRaw[0]);
    }

    const typedValues: SimulateActionFormValues = {
      actionType,
      moderatorName:
        typeof rawValues.moderatorName === 'string' && rawValues.moderatorName.trim().length > 0
          ? rawValues.moderatorName.trim()
          : undefined,
      targetUser:
        typeof rawValues.targetUser === 'string' && rawValues.targetUser.trim().length > 0
          ? rawValues.targetUser.trim()
          : undefined,
      includeModNote: Boolean(rawValues.includeModNote),
      modNote: typeof rawValues.modNote === 'string' ? rawValues.modNote : undefined,
      banDuration: (() => {
        if (typeof rawValues.banDuration === 'number') {
          return rawValues.banDuration;
        }
        if (typeof rawValues.banDuration === 'string' && rawValues.banDuration.trim().length > 0) {
          const parsed = Number(rawValues.banDuration);
          return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
      })(),
      customDetails:
        typeof rawValues.customDetails === 'string' && rawValues.customDetails.trim().length > 0
          ? rawValues.customDetails.trim()
          : undefined,
      slackChannel:
        typeof rawValues.slackChannel === 'string' && rawValues.slackChannel.trim().length > 0
          ? rawValues.slackChannel.trim()
          : undefined,
    };

    const moderatorName = typedValues.moderatorName ?? 'SimulationMod';
    const targetUser = typedValues.targetUser;
    const now = new Date();

    const modAction: ModActionData = {
      type: typedValues.actionType,
      moderatorName,
      subredditName: context.subredditName ?? 'unknown',
      description: typedValues.includeModNote ? (typedValues.modNote ?? 'Simulation note') : undefined,
      details: typedValues.customDetails,
      target: targetUser
        ? {
            author: targetUser,
            isComment: false,
          }
        : undefined,
      occurredAt: now,
      relatedAction: null,
      rapidFireAlert: null,
      isAutoModerator: moderatorName.toLowerCase() === 'automoderator',
    };

    if (typedValues.actionType === 'banuser') {
      const duration = typedValues.banDuration ?? 0;
      if (Number.isFinite(duration) && duration >= 0) {
        modAction.banDuration = duration;
        modAction.banDurationLabel = duration === 0 ? 'Permanent Ban' : `${duration} day${duration === 1 ? '' : 's'}`;
      }

      if (!modAction.details && modAction.banDuration !== undefined) {
        modAction.details = modAction.banDuration === 0
          ? 'permanent'
          : `${modAction.banDuration} day${modAction.banDuration === 1 ? '' : 's'}`;
      }
    }

    const slackMessage = await this.createSlackMessage(modAction, context, false);

    if (typedValues.slackChannel) {
      const channel = typedValues.slackChannel.startsWith('#')
        ? typedValues.slackChannel
        : `#${typedValues.slackChannel}`;
      slackMessage.channel = channel;
    }

    await this.sendToSlack(slackMessage);
  }

  /**
   * Get color code for different mod actions
   */
  private getActionColor(action: string): string {
    const colorMap: Record<string, string> = {
      'removelink': '#ff4444',      // Red for removals
      'removecomment': '#ff4444',   // Red for removals
      'spamlink': '#ff0088',        // Pink for spam
      'spamcomment': '#ff0088',     // Pink for spam
      'banuser': '#cc0000',         // Dark red for bans
      'unbanuser': '#00cc00',       // Green for unbans
      'lock': '#ff8800',            // Orange for locks
      'unlock': '#00cc00',          // Green for unlocks
      'sticky': '#0088ff',          // Blue for sticky
      'unsticky': '#888888',        // Gray for unsticky
      'approvelink': '#00cc00',     // Green for approvals
      'approvecomment': '#00cc00',  // Green for approvals
      'editflair': '#8800ff',       // Purple for flair edits
      'muteuser': '#ff8800',        // Orange for mutes
      'unmuteuser': '#00cc00',      // Green for unmutes
      'distinguish': '#0088ff',     // Blue for distinguish
      'ignorereports': '#888888',   // Gray for ignore reports
      'unignorereports': '#00cc00', // Green for unignore
      'snoozereports': '#ff8800',   // Orange for snooze
      'unsnoozereports': '#00cc00', // Green for unsnooze
      'addcontributor': '#00cc00',  // Green for adding approved user
      'removecontributor': '#ff4444', // Red for removing approved user
      'invitemoderator': '#0088ff', // Blue for mod invite
      'uninvitemoderator': '#ff8800', // Orange for uninvite
      'acceptmoderatorinvite': '#00cc00', // Green for accepting
      'addmoderator': '#0088ff',    // Blue for adding mod
      'removemoderator': '#ff4444', // Red for removing mod
      'editsettings': '#8800ff',    // Purple for settings changes
      'adjust_post_crowd_control_level': '#ff8800', // Orange for crowd control
      'enable_post_crowd_control_filter': '#ff8800', // Orange for enabling filter
      'disable_post_crowd_control_filter': '#00cc00' // Green for disabling filter
    };
    return colorMap[action] || '#666666';
  }

  private formatUserLink(username?: string | null): string {
    if (!username) {
      return 'Unknown';
    }

    const trimmed = username.trim();
    if (trimmed.length === 0) {
      return 'Unknown';
    }

    const normalized = trimmed.replace(/^u\//i, '');
    const encoded = encodeURIComponent(normalized);
    return `<https://www.reddit.com/u/${encoded}|u/${normalized}>`;
  }

  private formatContentLink(target?: ModActionData['target']): string | null {
    if (!target?.permalink) {
      return null;
    }

    const permalink = target.permalink.startsWith('http')
      ? target.permalink
      : `https://www.reddit.com${target.permalink}`;
    const label = target.isComment ? 'View Comment' : 'View Post';
    return `<${permalink}|${label}>`;
  }

  private formatTimestamp(date: Date | undefined): string {
    if (!date) {
      return 'Unknown time';
    }

    try {
      return `${date.toISOString().replace('T', ' ').replace(/\..+/, ' UTC')}`;
    } catch {
      return 'Unknown time';
    }
  }

  /**
   * Get human-readable action name with emoji
   */
  private getActionName(action: string, target?: ModActionData['target']): string {
    // Check if we're dealing with a comment target
    const isComment = target && target.isComment === true;
    
    const nameMap: Record<string, string> = {
      'removelink': '🗑️ Post Removed',
      'removecomment': '🗑️ Comment Removed',
      'spamlink': '🚫 Post Marked as Spam',
      'spamcomment': '🚫 Comment Marked as Spam',
      'banuser': '🔨 User Banned',
      'unbanuser': '🎉 User Unbanned',
      'lock': isComment ? '🔒 Comment Locked' : '🔒 Post Locked',
      'unlock': isComment ? '🔓 Comment Unlocked' : '🔓 Post Unlocked',
      'sticky': '📌 Post Stickied',
      'unsticky': '📌 Post Unstickied',
      'approvelink': '✅ Post Approved',
      'approvecomment': '✅ Comment Approved',
      'editflair': '🏷️ Flair Edited',
      'muteuser': '🔇 User Muted',
      'unmuteuser': '🔊 User Unmuted',
      'distinguish': '⭐ Distinguished',
      'ignorereports': '🔕 Reports Ignored',
      'unignorereports': '🔔 Reports Unignored',
      'snoozereports': '⏰ Reports Snoozed',
      'unsnoozereports': '⏰ Reports Unsnoozed',
      'addcontributor': '✅ Approved User Added',
      'removecontributor': '❌ Approved User Removed',
      'invitemoderator': '📨 Moderator Invited',
      'uninvitemoderator': '📭 Moderator Uninvited',
      'acceptmoderatorinvite': '✅ Moderator Invite Accepted',
      'addmoderator': '👤 Moderator Added',
      'removemoderator': '👤 Moderator Removed',
      'editsettings': '⚙️ Settings Edited',
      'adjust_post_crowd_control_level': '👥 Crowd Control Adjusted',
      'enable_post_crowd_control_filter': '🛡️ Crowd Control Enabled',
      'disable_post_crowd_control_filter': '🛡️ Crowd Control Disabled'
    };
    return nameMap[action] || action;
  }

  /**
   * Get human-readable action name without emoji (for message body)
   */
  private getActionNamePlain(action: string, target?: ModActionData['target']): string {
    // Check if we're dealing with a comment target
    const isComment = target && target.isComment === true;
    
    const nameMap: Record<string, string> = {
      'removelink': 'Post Removed',
      'removecomment': 'Comment Removed',
      'spamlink': 'Post Marked as Spam',
      'spamcomment': 'Comment Marked as Spam',
      'banuser': 'User Banned',
      'unbanuser': 'User Unbanned',
      'lock': isComment ? 'Comment Locked' : 'Post Locked',
      'unlock': isComment ? 'Comment Unlocked' : 'Post Unlocked',
      'sticky': 'Post Stickied',
      'unsticky': 'Post Unstickied',
      'approvelink': 'Post Approved',
      'approvecomment': 'Comment Approved',
      'editflair': 'Flair Edited',
      'muteuser': 'User Muted',
      'unmuteuser': 'User Unmuted',
      'distinguish': 'Distinguished',
      'ignorereports': 'Reports Ignored',
      'unignorereports': 'Reports Unignored',
      'snoozereports': 'Reports Snoozed',
      'unsnoozereports': 'Reports Unsnoozed',
      'addcontributor': 'Approved User Added',
      'removecontributor': 'Approved User Removed',
      'invitemoderator': 'Moderator Invited',
      'uninvitemoderator': 'Moderator Uninvited',
      'acceptmoderatorinvite': 'Moderator Invite Accepted',
      'addmoderator': 'Moderator Added',
      'removemoderator': 'Moderator Removed',
      'editsettings': 'Settings Edited',
      'adjust_post_crowd_control_level': 'Crowd Control Adjusted',
      'enable_post_crowd_control_filter': 'Crowd Control Enabled',
      'disable_post_crowd_control_filter': 'Crowd Control Disabled'
    };
    return nameMap[action] || action;
  }

  private parseBanDuration(rawDetails?: string | null): { days: number | null; label: string | null } {
    if (!rawDetails) {
      return { days: null, label: null };
    }

    const normalized = rawDetails.trim();
    if (normalized.length === 0) {
      return { days: null, label: null };
    }

    const lower = normalized.toLowerCase();
    if (lower.includes('permanent')) {
      return { days: 0, label: 'Permanent Ban' };
    }

    const dayMatch = normalized.match(/(\d+)\s*(?:day|d)\b/i);
    if (dayMatch) {
      const parsedDays = parseInt(dayMatch[1], 10);
      if (!Number.isNaN(parsedDays)) {
        return {
          days: parsedDays,
          label: `${parsedDays} day${parsedDays === 1 ? '' : 's'}`,
        };
      }
    }

    return { days: null, label: normalized };
  }

  private getDisciplineCategory(action: string | undefined): 'ban' | 'mute' | null {
    switch (action) {
      case 'banuser':
      case 'unbanuser':
        return 'ban';
      case 'muteuser':
      case 'unmuteuser':
        return 'mute';
      default:
        return null;
    }
  }

  /**
   * Sanitize string for use in Redis key (remove colons and whitespace)
   */
  private sanitizeKeyComponent(value: string): string {
    return value.toLowerCase().replace(/[:\s]/g, '_');
  }

  private getDisciplineKey(subredditName: string | undefined, username: string | undefined, category: 'ban' | 'mute'): string | null {
    if (!subredditName || !username) {
      return null;
    }
    const safeSub = this.sanitizeKeyComponent(subredditName);
    const safeUser = this.sanitizeKeyComponent(username);
    return `mod_actions:discipline:${category}:${safeSub}:${safeUser}`;
  }

  private async storeDisciplineContext(modAction: ModActionData, context: TriggerContext, category: 'ban' | 'mute'): Promise<void> {
    try {
      const targetUser = modAction.target?.author ?? undefined;
      const key = this.getDisciplineKey(modAction.subredditName, targetUser, category);
      if (!key) {
        return;
      }

      const redis = context.redis;
      const payload = {
        type: category,
        moderatorName: modAction.moderatorName ?? 'Unknown',
        timestamp: modAction.occurredAt?.getTime() ?? Date.now(),
        description: modAction.description ?? null,
        details: modAction.details ?? null,
      };

      await redis.set(key, JSON.stringify(payload), {
        expiration: new Date(Date.now() + ModActionSlackBot.DISCIPLINE_CONTEXT_TTL_SECONDS * 1000)
      });
    } catch {
      // Ignore Redis write failures
    }
  }

  private async hydrateDisciplineContext(modAction: ModActionData, context: TriggerContext, category: 'ban' | 'mute'): Promise<void> {
    try {
      const targetUser = modAction.target?.author ?? undefined;
      const key = this.getDisciplineKey(modAction.subredditName, targetUser, category);
      if (!key) {
        return;
      }

      const redis = context.redis;
      const raw = await redis.get(key);
      if (!raw) {
        return;
      }

      try {
        const parsed = JSON.parse(raw) as {
          type?: string;
          moderatorName?: string;
          timestamp?: number;
          description?: string | null;
          details?: string | null;
        };

        modAction.relatedAction = {
          type: parsed?.type === 'mute' ? 'muteuser' : 'banuser',
          moderatorName: parsed?.moderatorName ?? undefined,
          occurredAt: parsed?.timestamp ? new Date(parsed.timestamp) : undefined,
          description: parsed?.description ?? undefined,
          details: parsed?.details ?? undefined,
        };
      } catch {
        // Invalid JSON - ignore
      }

      await redis.del(key);
    } catch {
      // Ignore hydration failures
    }
  }

  private async evaluateRapidFire(modAction: ModActionData, context: TriggerContext): Promise<void> {
    try {
      if (!modAction.moderatorName || !modAction.subredditName) {
        return;
      }

      const windowMs = ModActionSlackBot.RAPID_FIRE_WINDOW_MS;
      const threshold = ModActionSlackBot.RAPID_FIRE_THRESHOLD;
      const now = Date.now();
      const redis = context.redis;
      const safeSub = this.sanitizeKeyComponent(modAction.subredditName);
      const safeMod = this.sanitizeKeyComponent(modAction.moderatorName);
      const key = `mod_actions:moderator_activity:${safeSub}:${safeMod}`;

      const raw = await redis.get(key);
      let timestamps: number[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            timestamps = parsed.filter((value) => typeof value === 'number');
          }
        } catch {
          // Invalid JSON - ignore
        }
      }

      timestamps = timestamps.filter((value) => now - value <= windowMs);
      timestamps.push(now);

      // Safety cap: prevent unbounded array growth if Redis expire() fails
      if (timestamps.length > ModActionSlackBot.RAPID_FIRE_MAX_TIMESTAMPS) {
        timestamps = timestamps.slice(-ModActionSlackBot.RAPID_FIRE_MAX_TIMESTAMPS);
      }

      if (timestamps.length >= threshold) {
        modAction.rapidFireAlert = {
          count: timestamps.length,
          windowSeconds: Math.floor(windowMs / 1000),
        };
      } else {
        modAction.rapidFireAlert = null;
      }

      await redis.set(key, JSON.stringify(timestamps), {
        expiration: new Date(Date.now() + ModActionSlackBot.RAPID_FIRE_TTL_SECONDS * 1000)
      });
    } catch {
      // Ignore rapid-fire tracking failures
    }
  }

  private async backfillBanDurationFromModLog(modAction: ModActionData, context: TriggerContext): Promise<void> {
    try {
      const subredditName = modAction.subredditName || await context.reddit.getCurrentSubredditName();
      if (!subredditName) {
        return;
      }

      const logListing = context.reddit.getModerationLog({
        subredditName,
        type: 'banuser',
        limit: 10,
      });

      const recentEntries = await logListing.get(10);
      if (!recentEntries || recentEntries.length === 0) {
        return;
      }

      const normalizedTarget = modAction.target?.author?.toLowerCase() ?? null;
      const normalizedModerator = modAction.moderatorName?.toLowerCase() ?? null;
      const occurredAt = modAction.occurredAt?.getTime() ?? null;

      const match = recentEntries.find((entry) => {
        if (!entry) return false;
        if (modAction.id && entry.id === modAction.id) {
          return true;
        }

        const entryTarget = entry.target?.author?.toLowerCase() ?? null;
        if (normalizedTarget && entryTarget && entryTarget === normalizedTarget) {
          if (!normalizedModerator || entry.moderatorName?.toLowerCase() === normalizedModerator) {
            return true;
          }
          if (!normalizedModerator) {
            return true;
          }
        }

        if (normalizedModerator && entry.moderatorName?.toLowerCase() === normalizedModerator) {
          if (!normalizedTarget) {
            return true;
          }
        }

        if (occurredAt) {
          const delta = Math.abs(entry.createdAt.getTime() - occurredAt);
          if (delta <= 2 * 60 * 1000) {
            if (!normalizedTarget || entry.target?.author?.toLowerCase() === normalizedTarget) {
              return true;
            }
          }
        }

        return false;
      });

      if (!match) {
        return;
      }

      if (!modAction.details && match.details) {
        modAction.details = match.details;
      }

      if (!modAction.description && match.description) {
        modAction.description = match.description;
      }

      const parsed = this.parseBanDuration(match.details ?? match.description ?? null);
      if (parsed.days !== null) {
        modAction.banDuration = parsed.days;
        modAction.banDurationLabel = parsed.label ?? modAction.banDurationLabel;
      } else if (!modAction.banDurationLabel && parsed.label) {
        modAction.banDurationLabel = parsed.label;
      }
    } catch {
      // Ignore backfill failures
    }
  }

  /**
   * Create Slack message payload from mod action
   */
  private async createSlackMessage(modAction: ModActionData, context: TriggerContext, isUnknownModerator: boolean = false): Promise<SlackMessage> {
    const actionName = this.getActionName(modAction.type, modAction.target);
    const actionNamePlain = this.getActionNamePlain(modAction.type, modAction.target);
    const color = isUnknownModerator ? '#ff0000' : this.getActionColor(modAction.type);

    const lines: string[] = [];
    const headlinePrefix = isUnknownModerator ? '🚨 *Security Alert*' : '🔔 *Moderator Action*';
    lines.push(`${headlinePrefix}`);
    lines.push(`• *Action:* ${actionNamePlain}`);

    const moderatorDisplay = this.formatUserLink(modAction.moderatorName);
    lines.push(`• *Moderator:* ${moderatorDisplay}`);

    if (modAction.target?.author) {
      lines.push(`• *Target:* ${this.formatUserLink(modAction.target.author)}`);
    }

    const contentLink = this.formatContentLink(modAction.target);
    if (contentLink) {
      lines.push(`• *Content:* ${contentLink}`);
    }

    if (modAction.target?.body) {
      const preview = modAction.target.body.length > 200
        ? `${modAction.target.body.slice(0, 200)}...`
        : modAction.target.body;
      if (preview.trim().length > 0) {
        lines.push(`> ${preview}`);
      }
    }

    lines.push(`• *When:* ${this.formatTimestamp(modAction.occurredAt)}`);

    if (modAction.type === 'banuser') {
      let durationText: string | null = null;

      if (modAction.banDuration !== undefined && modAction.banDuration !== null) {
        durationText = modAction.banDuration === 0
          ? 'Permanent Ban'
          : `${modAction.banDuration} day${modAction.banDuration === 1 ? '' : 's'}`;
      }

      if (!durationText && modAction.banDurationLabel) {
        durationText = modAction.banDurationLabel;
      }

      if (!durationText && modAction.details) {
        const trimmedDetails = modAction.details.trim();
        if (trimmedDetails.length > 0) {
          durationText = trimmedDetails;
        }
      }

      if (!durationText && modAction.description) {
        const fallbackParse = this.parseBanDuration(modAction.description);
        durationText = fallbackParse.label;
      }

      if (!durationText || durationText.length === 0) {
        durationText = 'Unknown Duration';
      }

      lines.push(`• *Ban Duration:* ${durationText}`);

    }

    // For crowd control actions, always show what changed
    const isCrowdControl = modAction.type === 'adjust_post_crowd_control_level' || 
                           modAction.type === 'enable_post_crowd_control_filter' || 
                           modAction.type === 'disable_post_crowd_control_filter';
    
    if (isCrowdControl) {
      // Show details (level change) or description if available
      if (modAction.details) {
        lines.push(`• *Level:* ${modAction.details}`);
      } else if (modAction.description) {
        lines.push(`• *Change:* ${modAction.description}`);
      }
    } else {
      // For non-crowd-control actions, show details if available
      if (modAction.details) {
        lines.push(`• *Details:* ${modAction.details}`);
      }
    }

    if (this.config.includeModNote && modAction.description && !isCrowdControl) {
      lines.push(`• *Mod Note:* ${modAction.description}`);
    }

    if ((modAction.type === 'unbanuser' || modAction.type === 'unmuteuser') && modAction.relatedAction) {
      const pieces: string[] = [];
      if (modAction.relatedAction.moderatorName) {
        pieces.push(`Moderator ${this.formatUserLink(modAction.relatedAction.moderatorName)}`);
      }
      if (modAction.relatedAction.occurredAt) {
        pieces.push(`on ${modAction.relatedAction.occurredAt.toISOString()}`);
      }
      const detailSnippet = modAction.relatedAction.details || modAction.relatedAction.description;
      if (detailSnippet) {
        pieces.push(`Details ${detailSnippet}`);
      }
      if (pieces.length > 0) {
        const relatedTitle = modAction.type === 'unmuteuser' ? 'Related Mute' : 'Related Ban';
        lines.push(`• *${relatedTitle}:* ${pieces.join(' • ')}`);
      }
    }

    const statusTokens: string[] = [];
    if (isUnknownModerator) {
      statusTokens.push('Unknown moderator (alert)');
    }
    if (modAction.isAutoModerator) {
      statusTokens.push('Origin AutoModerator');
    }
    if (modAction.rapidFireAlert && modAction.rapidFireAlert.count >= ModActionSlackBot.RAPID_FIRE_THRESHOLD) {
      statusTokens.push(`Activity spike ${modAction.rapidFireAlert.count} actions / ${Math.round(modAction.rapidFireAlert.windowSeconds / 60)} min`);
    }

    if (statusTokens.length > 0) {
      lines.push(`• *Status:* ${statusTokens.join(' | ')}`);
    }

    const attachmentBody = lines.join('\n');

    const message: SlackMessage = {
      text: isUnknownModerator
        ? `🚨 SECURITY ALERT: ${actionName} by unknown moderator`
        : actionName,
      username: 'Reddit Mod Bot',
      icon_emoji: isUnknownModerator ? ':warning:' : ':shield:',
      attachments: [
        {
          color,
          text: attachmentBody,
          mrkdwn_in: ['text', 'fields'],
          footer: 'Reddit Mod Action Bot',
          ts: Math.floor((modAction.occurredAt?.getTime() ?? Date.now()) / 1000)
        }
      ]
    };

    // Choose the appropriate channel
    const targetChannel = isUnknownModerator && this.config.alertChannel 
      ? this.config.alertChannel 
      : this.config.notificationChannel;

    if (targetChannel) {
      message.channel = targetChannel.startsWith('#') 
        ? targetChannel 
        : `#${targetChannel}`;
    }

    return message;
  }

  /**
   * Check if an alert should be throttled to prevent spam
   * @param redis Redis client from TriggerContext
   * @param alertType Type of alert (e.g., 'modqueue_size', 'modqueue_unmoderated')
   * @param throttleSeconds How long to throttle between alerts
   * @returns true if alert should be suppressed (throttled), false if it should be sent
   */
  private async isAlertThrottled(
    redis: TriggerContext['redis'],
    alertType: string,
    throttleSeconds: number
  ): Promise<boolean> {
    const throttleKey = `mod_actions:throttle:${alertType}`;
    const lastSent = await redis.get(throttleKey);
    
    if (lastSent) {
      return true;
    }
    
    // Set throttle key with expiration
    await redis.set(
      throttleKey,
      Date.now().toString(),
      { expiration: new Date(Date.now() + throttleSeconds * 1000) }
    );
    
    return false;
  }

  /**
   * Send message to Slack with retry logic
   */
  private async sendToSlack(message: SlackMessage, retryCount = 0): Promise<void> {
    if (!this.config.slackWebhookUrl) {
      console.error('Slack webhook URL not configured');
      return;
    }

    const maxRetries = ModActionSlackBot.SLACK_RETRY_MAX_ATTEMPTS;
    const baseDelay = ModActionSlackBot.SLACK_RETRY_BASE_DELAY_MS;

    try {
      const response = await fetch(this.config.slackWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(message),
      });

      if (!response.ok) {
        const responseText = await response.text();
        
        // Retry on server errors (5xx) or rate limiting (429)
        if ((response.status >= 500 || response.status === 429) && retryCount < maxRetries) {
          const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.sendToSlack(message, retryCount + 1);
        }
        
        console.error('Slack webhook request failed - verify webhook URL is correct:', {
          status: response.status,
          statusText: response.statusText,
          responseText,
          troubleshooting: 'Check: 1) Webhook URL is valid, 2) Slack workspace permissions, 3) Network connectivity',
        });
      } else {
        await response.text().catch(() => null);
        // Success - message sent
      }
    } catch (error) {
      // Check for timeout/deadline errors specifically
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Retry on network errors if we haven't exceeded max retries
      if (retryCount < maxRetries && !errorMessage.includes('deadline exceeded')) {
        const delay = baseDelay * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.sendToSlack(message, retryCount + 1);
      }
      
      if (errorMessage.includes('deadline exceeded') || errorMessage.includes('timeout')) {
        console.error('Slack webhook request timed out - Slack may be experiencing delays or webhook URL may be incorrect', {
          channel: message.channel ?? 'default',
          error: errorMessage,
          troubleshooting: 'Verify webhook URL in settings and check Slack status at status.slack.com',
        });
      } else {
        console.error('Error sending Slack message - check webhook URL and network connectivity:', error);
      }
      // Don't throw - Slack delivery failure shouldn't break the event pipeline
    }
  }

  /**
   * Handle scheduler failure tracking and alerting
   */
  private async handleSchedulerFailure(context: TriggerContext, error: Error): Promise<void> {
    try {
      const redis = context.redis;
      const failureKey = ModActionSlackBot.SCHEDULER_FAILURE_KEY;
      
      // Increment failure counter
      const count = await redis.incrBy(failureKey, 1);
      
      // Alert after reaching threshold
      if (count >= ModActionSlackBot.SCHEDULER_FAILURE_THRESHOLD) {
        await this.loadConfig(context);
        
        if (this.config.slackWebhookUrl) {
          const alertMessage: SlackMessage = {
            text: `⚠️ Critical: Modqueue Monitoring Failed ${count} Times`,
            username: 'Reddit Mod Bot',
            icon_emoji: ':warning:',
            attachments: [
              {
                color: '#ff0000',
                fields: [
                  {
                    title: '❌ Status',
                    value: 'Scheduler job has failed repeatedly',
                    short: true,
                  },
                  {
                    title: '🔢 Failure Count',
                    value: count.toString(),
                    short: true,
                  },
                  {
                    title: '🔍 Error',
                    value: error.message || 'Unknown error',
                    short: false,
                  },
                  {
                    title: '⚙️ Action Required',
                    value: 'Check bot configuration and permissions',
                    short: false,
                  },
                ],
                footer: 'Reddit Mod Action Bot - Scheduler Monitor',
                ts: Math.floor(Date.now() / 1000),
              },
            ],
          };

          if (this.config.alertChannel) {
            alertMessage.channel = this.config.alertChannel.startsWith('#')
              ? this.config.alertChannel
              : `#${this.config.alertChannel}`;
          }

          await this.sendToSlack(alertMessage);
        }
        
        // Reset counter after alert
        await redis.del(failureKey);
      } else {
        // Set 1-hour expiration on failure counter to auto-reset if errors stop
        await redis.expire(failureKey, ModActionSlackBot.SCHEDULER_FAILURE_TTL_SECONDS);
      }
    } catch {
      // Don't let failure tracking break the scheduler
      console.error('Failed to track scheduler failures');
    }
  }

  /**
   * Reset scheduler failure counter after successful run
   */
  private async resetSchedulerFailures(context: TriggerContext): Promise<void> {
    try {
      await context.redis.del(ModActionSlackBot.SCHEDULER_FAILURE_KEY);
    } catch {
      // Ignore reset failures
    }
  }

  /**
   * Check modqueue size and unmoderated content age
   */
  async checkModqueue(context: TriggerContext): Promise<void> {
    await this.loadConfig(context);

    if (!this.config.slackWebhookUrl) {
      return;
    }

    const subreddit = await context.reddit.getCurrentSubreddit();
    const threshold = this.config.modqueueThreshold;
    const unmoderagedHours = this.config.unmoderagedAgeHours;

    try {
      // Fetch modqueue items
      const modqueueListing = await subreddit.getModQueue({ type: 'all' });
      const modqueue = await modqueueListing.all();

      const queueSize = modqueue.length;

      // Alert if modqueue exceeds threshold
      if (threshold > 0 && queueSize >= threshold) {
        // Check if this alert is throttled
        const isThrottled = await this.isAlertThrottled(
          context.redis,
          'modqueue_size',
          ModActionSlackBot.MODQUEUE_ALERT_THROTTLE_SECONDS
        );
        
        if (isThrottled) {
          // Skip - alert sent recently
        } else {
          // Count posts and comments
          let postCount = 0;
          let commentCount = 0;
          for (const item of modqueue) {
            if ('title' in item) {
              postCount++;
            } else {
              commentCount++;
            }
          }

          const alertMessage: SlackMessage = {
            text: `⚠️ Modqueue Alert: ${queueSize} items pending`,
            username: 'Reddit Mod Bot',
            icon_emoji: ':warning:',
            attachments: [
              {
                color: '#ff9900',
                fields: [
                  {
                    title: '📋 Queue Size',
                    value: queueSize.toString(),
                    short: true,
                  },
                  {
                    title: '📝 Posts',
                    value: postCount.toString(),
                    short: true,
                  },
                  {
                    title: '💬 Comments',
                    value: commentCount.toString(),
                    short: true,
                  },
                  {
                    title: '🎯 Threshold',
                    value: threshold.toString(),
                    short: true,
                  },
                ],
              footer: 'Reddit Mod Action Bot - Modqueue Monitor',
              ts: Math.floor(Date.now() / 1000),
            },
          ],
        };

        if (this.config.alertChannel) {
          alertMessage.channel = this.config.alertChannel.startsWith('#')
            ? this.config.alertChannel
            : `#${this.config.alertChannel}`;
        }

        await this.sendToSlack(alertMessage);
        }
      }

      // Check for old unmoderated content
      if (unmoderagedHours > 0) {
        const now = Date.now();
        const ageThresholdMs = unmoderagedHours * 60 * 60 * 1000;
        const oldItems = modqueue.filter(item => {
          const createdAt = new Date(item.createdAt).getTime();
          return (now - createdAt) >= ageThresholdMs;
        });

        if (oldItems.length > 0) {
          // Check if this alert is throttled
          const isThrottled = await this.isAlertThrottled(
            context.redis,
            'modqueue_unmoderated',
            ModActionSlackBot.MODQUEUE_ALERT_THROTTLE_SECONDS
          );
          
          if (isThrottled) {
            // Skip - alert sent recently
          } else {
            // Sort by age ascending (oldest first)
            oldItems.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
            const oldest = oldItems.slice(0, 5); // Top 5 oldest

            const itemsList = oldest.map(item => {
              const age = Math.floor((now - item.createdAt.getTime()) / (60 * 60 * 1000));
              const isPost = 'title' in item;
              const type = isPost ? 'Post' : 'Comment';
              const link = `https://reddit.com${item.permalink}`;
              return `• ${type} (${age}h old): ${link}`;
            }).join('\n');

            const unmoderagedMessage: SlackMessage = {
              text: `⏰ Unmoderated Content Alert: ${oldItems.length} items over ${unmoderagedHours}h old`,
              username: 'Reddit Mod Bot',
              icon_emoji: ':alarm_clock:',
              attachments: [
                {
                  color: '#ff6600',
                  fields: [
                    {
                      title: `📌 Oldest Items (showing ${oldest.length} of ${oldItems.length})`,
                      value: itemsList,
                      short: false,
                    },
                  ],
                  footer: 'Reddit Mod Action Bot - Unmoderated Monitor',
                  ts: Math.floor(Date.now() / 1000),
                },
              ],
            };

            if (this.config.alertChannel) {
              unmoderagedMessage.channel = this.config.alertChannel.startsWith('#')
                ? this.config.alertChannel
                : `#${this.config.alertChannel}`;
            }

            await this.sendToSlack(unmoderagedMessage);
          }
        }
      }
      
      // Reset failure counter on successful run
      await this.resetSchedulerFailures(context);
    } catch (error) {
      console.error('Failed to check modqueue:', error);
      
      // Track failure and potentially alert
      if (error instanceof Error) {
        await this.handleSchedulerFailure(context, error);
      }
      
      throw error; // Re-throw to ensure scheduler marks job as failed
    }
  }

  /**
   * Send a test message to Slack (for debugging)
   */
  async testSlackConnection(context: TriggerContext): Promise<void> {
    await this.loadConfig(context);
    
    if (!this.config.slackWebhookUrl) {
      console.error('Cannot test: Slack webhook URL not configured');
      return;
    }

    const testMessage: SlackMessage = {
      text: '🧪 Test message from Reddit Mod Action Bot',
      username: 'Reddit Mod Bot (Test)',
      icon_emoji: ':robot_face:',
      attachments: [
        {
          color: '#00ff00',
          fields: [
            {
              title: 'Status',
              value: 'Bot is working correctly!',
              short: true
            },
            {
              title: 'Timestamp',
              value: new Date().toISOString(),
              short: true
            }
          ],
          footer: 'Reddit Mod Action Bot - Test Message'
        }
      ]
    };

    await this.sendToSlack(testMessage);
  }

  /**
   * Handle mod action event
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleModAction(event: any, context: TriggerContext): Promise<void> {
    await this.loadConfig(context);

    const modActionSource = event?.modAction ?? event?.modaction ?? event;

    if (!this.config.slackWebhookUrl) {
      console.error('Slack webhook URL not configured - skipping notification');
      return;
    }

    // Extract the mod action data from the event
    const resolvedId = modActionSource?.id ?? event.id ?? event.modActionId ?? event.mod_action_id ?? null;
    const modAction = {
      id: typeof resolvedId === 'string' ? resolvedId : resolvedId != null ? String(resolvedId) : undefined,
      type: event.action, // The actual action type (removelink, lock, etc.)
      moderatorName: event.moderator?.name,
      subredditName: event.subreddit?.name,
  description: (modActionSource?.description ?? event.description ?? '') || '',
  details: modActionSource?.details ?? event.details ?? undefined,
      banDuration: undefined,
      banDurationLabel: undefined,
      relatedAction: null,
      rapidFireAlert: null,
      occurredAt: (() => {
        // Try multiple possible timestamp fields in order of preference
        const source = 
          modActionSource?.createdAt ?? 
          event.createdAt ?? 
          event.created_at ?? 
          event.triggeredAt ??
          event.triggered_at ??
          modActionSource?.timestamp ??
          event.timestamp ??
          null;
        
        if (!source) {
          // If no timestamp found, use current time as fallback
          return new Date();
        }
        
        if (source instanceof Date) return source;
        if (typeof source === 'string') {
          const parsed = new Date(source);
          return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
        }
        if (typeof source === 'number') {
          return new Date(source * (source > 10_000_000_000 ? 1 : 1000));
        }
        if (typeof source === 'object' && 'seconds' in source) {
          const seconds = Number(source.seconds ?? 0);
          const nanos = Number(source.nanos ?? 0);
          return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
        }
        return new Date();
      })(),
  target: event.targetPost?.id ? {
        author: event.targetUser?.name || event.targetPost?.authorId,
        permalink: event.targetPost?.permalink,
        body: event.targetPost?.selftext || event.targetPost?.title,
        isComment: false
      } : event.targetComment?.id ? {
        author: event.targetUser?.name || event.targetComment?.author,
        permalink: event.targetComment?.permalink,
        body: event.targetComment?.body,
        isComment: true
      } : event.targetUser?.name ? {
        author: event.targetUser.name,
        permalink: null,
        body: null,
        isComment: false
      } : modActionSource?.target ? {
        author: modActionSource.target.author ?? undefined,
        permalink: modActionSource.target.permalink ?? null,
        body: modActionSource.target.body ?? modActionSource.target.title ?? null,
        isComment: Boolean(modActionSource.target.body && !modActionSource.target.title)
      } : null
    } as ModActionData;

    if (modAction.details !== undefined && modAction.details !== null) {
      modAction.details = String(modAction.details);
    }

    modAction.isAutoModerator = (modAction.moderatorName ?? '').toLowerCase() === 'automoderator';
    
    if (modAction.type === 'banuser') {
      const numericBanDuration = modActionSource?.duration ?? modActionSource?.banDuration ?? modActionSource?.ban_duration ??
        event.duration ?? event.banDuration ?? event.ban_duration ?? event.days ?? event.banDays ?? event.ban_days;
      const detailsInfo = this.parseBanDuration(modAction.details);
      const descriptionInfo = modAction.details ? { days: null, label: null } : this.parseBanDuration(modAction.description);

      if (typeof numericBanDuration === 'number' && !Number.isNaN(numericBanDuration)) {
        modAction.banDuration = numericBanDuration;
        modAction.banDurationLabel = numericBanDuration === 0
          ? 'Permanent Ban'
          : `${numericBanDuration} day${numericBanDuration === 1 ? '' : 's'}`;
      } else if (detailsInfo.days !== null) {
        modAction.banDuration = detailsInfo.days;
        modAction.banDurationLabel = detailsInfo.label || undefined;
      } else if (descriptionInfo.days !== null) {
        modAction.banDuration = descriptionInfo.days;
        modAction.banDurationLabel = descriptionInfo.label || undefined;
      } else {
        modAction.banDuration = undefined;
        modAction.banDurationLabel = detailsInfo.label || descriptionInfo.label || undefined;
      }

      const hasDurationMetadata = (modAction.banDuration !== undefined && modAction.banDuration !== null) ||
        (modAction.banDurationLabel && modAction.banDurationLabel.trim().length > 0) ||
        (modAction.details && modAction.details.trim().length > 0);

      if (!hasDurationMetadata) {
        await this.backfillBanDurationFromModLog(modAction, context);
      }
    }
    const actionType = modAction.type || 'unknown';

    const disciplineCategory = this.getDisciplineCategory(actionType);
    if (disciplineCategory === 'ban' && actionType === 'banuser') {
      await this.storeDisciplineContext(modAction, context, disciplineCategory);
    } else if (disciplineCategory === 'mute' && actionType === 'muteuser') {
      await this.storeDisciplineContext(modAction, context, disciplineCategory);
    } else if (disciplineCategory && (actionType === 'unbanuser' || actionType === 'unmuteuser')) {
      await this.hydrateDisciplineContext(modAction, context, disciplineCategory);
    }

    if (!modAction.isAutoModerator) {
      await this.evaluateRapidFire(modAction, context);
    }

    if (!this.config.enabledActions.includes(actionType)) {
      return;
    }

    const moderatorName = modAction.moderatorName || 'Unknown';

    if (this.isModeratorExcluded(moderatorName)) {
      return;
    }

    let isUnknownModerator = false;
    if (this.config.flagUnknownModerators && moderatorName !== 'Unknown') {
      const isOfficial = await this.isOfficialModerator(moderatorName, context);
      if (!isOfficial) {
        isUnknownModerator = true;
        console.warn('Mod action by unknown moderator', { moderator: moderatorName, action: actionType });
      }
    }

    // Skip Slack notification for AutoModerator if alerts are disabled
    if (!this.config.enableAutoModAlerts && modAction.isAutoModerator) {
      return;
    }
    
    const slackMessage = await this.createSlackMessage(modAction, context, isUnknownModerator);
    await this.sendToSlack(slackMessage);
  }

  /**
   * Handle PostDelete event - alert when users delete high-score posts
   */
  async handlePostDelete(event: Record<string, unknown>, context: TriggerContext): Promise<void> {
    await this.loadConfig(context);

    const threshold = this.config.postDeletionUpvoteThreshold;
    if (threshold <= 0) {
      return;
    }

    if (!this.config.slackWebhookUrl) {
      return;
    }

    try {
      // PostDelete event structure: { postId, author?, subreddit?, deletedAt, reason, source }
      const postId = event.postId as string | undefined;
      if (!postId) {
        console.error('PostDelete event missing postId');
        return;
      }

      const source = event.source as number | undefined;
      // Only alert for user-deleted posts (not moderator removals)
      // EventSource.USER = 1
      if (source !== 1) {
        return;
      }

      // Try to get cached post data from Redis
      const cacheKey = `post_score:${postId}`;
      const cachedData = await context.redis.get(cacheKey);
      
      if (!cachedData) {
        return;
      }

      const postData = JSON.parse(cachedData) as {
        score: number;
        title: string;
        authorName: string;
        permalink: string;
        subredditName: string;
      };

      const score = postData.score;

      if (score < threshold) {
        return;
      }

      const subreddit = event.subreddit as Record<string, unknown> | undefined;
      const subredditName = postData.subredditName || ((subreddit?.name as string) ?? 'Unknown');
      const deletedAt = event.deletedAt ? new Date(event.deletedAt as string).toISOString() : new Date().toISOString();
      const reason = (event.reason as string) ?? 'Unknown';

      const alertMessage: SlackMessage = {
        text: `🗑️ User Deleted High-Score Post: ${score} upvotes`,
        username: 'Reddit Mod Bot',
        icon_emoji: ':wastebasket:',
        attachments: [
          {
            color: '#cc0000',
            fields: [
              {
                title: '📝 Title',
                value: postData.title,
                short: false,
              },
              {
                title: '👤 Author',
                value: `/u/${postData.authorName}`,
                short: true,
              },
              {
                title: '⬆️ Score',
                value: score.toString(),
                short: true,
              },
              {
                title: '🗑️ Reason',
                value: reason,
                short: true,
              },
              {
                title: '📍 Subreddit',
                value: `/r/${subredditName}`,
                short: true,
              },
              {
                title: '🔗 Link (may be dead)',
                value: `https://reddit.com${postData.permalink}`,
                short: false,
              },
              {
                title: '⏰ Deleted At',
                value: deletedAt,
                short: true,
              },
            ],
            footer: 'Reddit Mod Action Bot - Post Deletion Monitor',
            ts: Math.floor(Date.now() / 1000),
          },
        ],
      };

      if (this.config.alertChannel) {
        alertMessage.channel = this.config.alertChannel.startsWith('#')
          ? this.config.alertChannel
          : `#${this.config.alertChannel}`;
      }

      await this.sendToSlack(alertMessage);
      
      // Clean up cache
      await context.redis.del(cacheKey);
    } catch (error) {
      console.error('Failed to handle post delete:', error);
    }
  }

  /**
   * Cache post score data for later deletion tracking
   */
  async cachePostScore(event: Record<string, unknown>, context: TriggerContext): Promise<void> {
    await this.loadConfig(context);

    const threshold = this.config.postDeletionUpvoteThreshold;
    if (threshold <= 0) {
      return; // Feature disabled, don't cache
    }

    try {
      const post = event.post as Record<string, unknown> | undefined;
      if (!post) {
        return;
      }

      const postId = post.id as string | undefined;
      const score = post.score as number | undefined;
      
      if (!postId || score === undefined) {
        return;
      }

      // Only cache posts that are approaching the threshold (to save Redis space)
      // Cache if score is at least 50% of threshold
      if (score < threshold * 0.5) {
        return;
      }

      const cacheKey = `post_score:${postId}`;
      const postData = {
        score,
        title: (post.title as string) ?? 'Untitled',
        authorName: (post.authorName as string) ?? 'Unknown',
        permalink: (post.permalink as string) ?? '',
        subredditName: (post.subredditName as string) ?? 'Unknown',
      };

      await context.redis.set(
        cacheKey,
        JSON.stringify(postData),
        { expiration: new Date(Date.now() + ModActionSlackBot.POST_SCORE_CACHE_TTL_SECONDS * 1000) }
      );
    } catch {
      // Ignore cache failures
    }
  }
}

// Initialize the bot
const bot = new ModActionSlackBot();

// Register app installation handler - set up default monitoring
Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_event, context) => {
    try {
      // Set up modqueue monitoring with default settings
      await bot.setupModqueueMonitoring(context);
    } catch (error) {
      console.error('Failed to auto-setup modqueue monitoring on install:', error);
    }
  },
});

// Register app upgrade handler - ensure monitoring is set up
Devvit.addTrigger({
  event: 'AppUpgrade',
  onEvent: async (_event, context) => {
    try {
      // Set up modqueue monitoring with current settings
      await bot.setupModqueueMonitoring(context);
    } catch (error) {
      console.error('Failed to setup modqueue monitoring on upgrade:', error);
    }
  },
});

// Register mod action handler
Devvit.addTrigger({
  event: 'ModAction',
  onEvent: bot.handleModAction.bind(bot),
});

// Register post delete handler
Devvit.addTrigger({
  event: 'PostDelete',
  onEvent: async (event, context) => {
    try {
      await bot.handlePostDelete(event as unknown as Record<string, unknown>, context);
    } catch (error) {
      console.error('Failed to handle post delete:', error);
    }
  },
});

// Register post create handler for caching scores
Devvit.addTrigger({
  event: 'PostCreate',
  onEvent: async (event, context) => {
    try {
      await bot.cachePostScore(event as unknown as Record<string, unknown>, context);
    } catch {
      // Ignore cache failures
    }
  },
});

// Register post update handler for caching scores
Devvit.addTrigger({
  event: 'PostUpdate',
  onEvent: async (event, context) => {
    try {
      await bot.cachePostScore(event as unknown as Record<string, unknown>, context);
    } catch {
      // Ignore cache failures
    }
  },
});

// Add scheduler for modqueue monitoring
Devvit.addSchedulerJob({
  name: 'modqueueMonitor',
  onRun: async (event, context) => {
    // Error handling is done inside checkModqueue
    // to properly track failures and send alerts
    await bot.checkModqueue(context);
  },
});

// Forms surfaced via subreddit menu entries
const testForm = Devvit.createForm(
  {
    title: 'Reddit Mod Action Bot',
    description: 'Test your bot configuration and send a test alert to Slack',
    fields: [
      {
        name: 'info',
        label: 'Bot Status',
        type: 'paragraph',
        defaultValue: 'This bot monitors moderator actions and sends notifications to Slack. Click "Send Test Alert" to verify your webhook configuration.',
        disabled: true,
      },
    ],
    acceptLabel: 'Send Test Alert',
    cancelLabel: 'Close',
  },
  async (_values, context) => {
    try {
      await bot.testSlackConnection(context);
      context.ui.showToast({
        text: '🧪 Test alert sent! Check your Slack channel and bot logs.',
        appearance: 'success',
      });
    } catch (error) {
      console.error('Error sending test alert - check webhook URL and Slack permissions:', error);
      context.ui.showToast({
        text: '❌ Failed to send test alert. Verify webhook URL in settings.',
        appearance: 'neutral',
      });
    }
  }
);

const simulateActionForm = Devvit.createForm(
  {
    title: 'Simulate Mod Action',
    description: 'Send a simulated moderator action to Slack without touching live data.',
    fields: [
      {
        name: 'actionType',
        label: 'Action Type',
        type: 'select',
        options: [
          { label: 'Remove Post', value: 'removelink' },
          { label: 'Remove Comment', value: 'removecomment' },
          { label: 'Ban User', value: 'banuser' },
          { label: 'Unban User', value: 'unbanuser' },
          { label: 'Mute User', value: 'muteuser' },
          { label: 'Unmute User', value: 'unmuteuser' },
        ],
        defaultValue: ['removelink'],
      },
      {
        name: 'moderatorName',
        label: 'Moderator Name',
        type: 'string',
        helpText: 'Optional. Defaults to SimulationMod when left blank.',
      },
      {
        name: 'targetUser',
        label: 'Target Username',
        type: 'string',
        helpText: 'Optional username this action should apply to.',
      },
      {
        name: 'includeModNote',
        label: 'Include Mod Note?',
        type: 'boolean',
        defaultValue: false,
      },
      {
        name: 'modNote',
        label: 'Mod Note',
        type: 'string',
        helpText: 'Optional text that will be included when Include Mod Note is enabled.',
      },
      {
        name: 'banDuration',
        label: 'Ban Duration (days)',
        type: 'number',
        helpText: 'Only used for ban actions. Specify 0 for a permanent ban.',
      },
      {
        name: 'customDetails',
        label: 'Custom Details',
        type: 'string',
        helpText: 'Optional override for the automatic details field.',
      },
      {
        name: 'slackChannel',
        label: 'Slack Channel Override',
        type: 'string',
        helpText: 'Optional channel like #moderators. Uses default channel when blank.',
      },
    ],
    acceptLabel: 'Send Simulation',
    cancelLabel: 'Cancel',
  },
  async ({ values }, context) => {
    try {
      await bot.simulateModAction(values as Record<string, unknown>, context);
      context.ui.showToast({
        text: '✅ Simulation delivered to Slack!',
        appearance: 'success',
      });
    } catch (error) {
      console.error('Failed to send simulated action', error);
      context.ui.showToast({
        text: '❌ Could not send simulation. Check logs.',
        appearance: 'neutral',
      });
    }
  }
);

// Essential menu items for moderators only
Devvit.addMenuItem({
  label: 'Test Slack Connection',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { ui } = context;
    ui.showForm(testForm);
  },
});

Devvit.addMenuItem({
  label: 'Show Bot Status',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    const { ui } = context;
    try {
      const summary = await bot.getStatusSummary(context);
      ui.showToast({
        text: summary.replace(/\n/g, ' • '),
        appearance: 'neutral',
      });
    } catch (error) {
      console.error('Failed to display status summary', error);
      ui.showToast({
        text: '❌ Unable to fetch status. Check logs.',
        appearance: 'neutral',
      });
    }
  },
});

Devvit.addMenuItem({
  label: 'Simulate Mod Action',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    context.ui.showForm(simulateActionForm);
  },
});

Devvit.addMenuItem({
  label: 'Setup Modqueue Monitoring',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    try {
      const result = await bot.setupModqueueMonitoring(context);
      if (result.enabled) {
        context.ui.showToast({
          text: `✅ Modqueue monitoring enabled (Job ID: ${result.jobId || 'unknown'})`,
          appearance: 'success',
        });
      } else {
        context.ui.showToast({
          text: '⚠️ Modqueue monitoring disabled (thresholds set to 0)',
          appearance: 'neutral',
        });
      }
    } catch (error) {
      console.error('Failed to setup modqueue monitoring:', error);
      context.ui.showToast({
        text: '❌ Failed to setup modqueue monitoring',
        appearance: 'neutral',
      });
    }
  },
});

// Export default for Devvit
export default Devvit;
