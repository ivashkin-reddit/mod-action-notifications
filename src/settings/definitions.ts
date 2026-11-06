import type { SettingsFormField } from "@devvit/public-api";
import {
    approvalDaysProblem,
    botTokenProblem,
    dormantDaysProblem,
    historyDaysProblem,
    retentionProblem,
    wholeNumberProblem,
} from "./validation.js";

/** The settings moderators fill in, with what each is checked for on saving. */

export const DEFAULT_MODQUEUE_THRESHOLD = 50;
export const DEFAULT_UNMODERATED_AGE_HOURS = 24;
export const DEFAULT_REPORTED_CONTENT_AGE_HOURS = 24;
export const DEFAULT_POST_DELETION_UPVOTE_THRESHOLD = 100;
export const DEFAULT_SPAM_QUEUE_THRESHOLD = 0;
export const DEFAULT_BAN_HISTORY_DAYS = 30;
export const DEFAULT_DORMANT_MODERATOR_DAYS = 90;
export const DEFAULT_EDITED_QUEUE_THRESHOLD = 0;
export const DEFAULT_REPORT_PILE_UP_THRESHOLD = 0;
export const DEFAULT_MODMAIL_WAIT_HOURS = 24;
export const DEFAULT_EDITS_AFTER_APPROVAL_DAYS = 7;
/** The free Slack plan's only retention short of a year. */
export const DEFAULT_SLACK_RETENTION_DAYS = 90;

/**
 * What the Enabled Mod Actions setting offers, and those it starts with. The moderation module knows the mod
 * actions; the composition root passes them in.
 */
export type ModActionChoices = Readonly<{
    options: readonly Readonly<{ label: string; value: string }>[];
    defaults: readonly string[];
}>;

/** The settings after Enabled Mod Actions, in form order. */
const OTHER_SETTINGS: readonly SettingsFormField[] = [
    {
        type: "string",
        name: "excludedModerators",
        label: "Excluded Moderators",
        helpText: "Comma-separated list of moderator usernames to exclude (e.g., AutoModerator, BotName)",
    },
    {
        type: "boolean",
        name: "flagUnknownModerators",
        label: "Flag Unknown Moderators",
        helpText: "Send special alerts for mod actions by accounts not on the moderator list",
        defaultValue: true,
    },
    {
        type: "boolean",
        name: "securityAlerts",
        label: "Security Alerts",
        helpText:
            "Always send changes to the mod team (moderators added, removed or invited, permissions changed) and to Devvit apps (installed, removed, enabled, disabled or changed) as security alerts to the alert channel, whatever Enabled Mod Actions and Excluded Moderators say. Also alert on edits to AutoModerator's config, AutoModerator removing far more than usual after one, and moderators acting after a long silence",
        defaultValue: true,
    },
    {
        type: "number",
        name: "dormantModeratorDays",
        label: "Dormant Moderator Alert (Days)",
        helpText:
            "Send a security alert when a moderator acts for the first time in at least this many days, as a compromised account might (0 to disable, at most 365)",
        defaultValue: DEFAULT_DORMANT_MODERATOR_DAYS,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            dormantDaysProblem(value),
    },
    {
        type: "boolean",
        name: "includeModNote",
        label: "Include Mod Note",
        helpText: "Include moderator notes in Slack notifications",
        defaultValue: true,
    },
    {
        type: "number",
        name: "banHistoryDays",
        label: "Ban Alert History (Days)",
        helpText:
            "Ban alerts count the user's entries in Reddit's mod notes (removals, spam removals, bans, mutes and notes) from this many days before the ban, never their text (0 leaves the history out)",
        defaultValue: DEFAULT_BAN_HISTORY_DAYS,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            historyDaysProblem(value),
    },
    {
        type: "string",
        name: "notificationChannel",
        label: "Notification Channel",
        helpText:
            "The Slack channel for alerts and the daily summary: its channel ID (in the channel's details, starting C), or a public channel's name. Add the Slack app to the channel. Required",
    },
    {
        type: "string",
        name: "alertChannel",
        label: "Alert Channel",
        helpText:
            "The Slack channel for security, modqueue and deleted-post alerts: its ID or name, as for the notification channel (optional; uses the notification channel if empty)",
    },
    {
        type: "number",
        name: "slackRetentionDays",
        label: "Slack Message Retention (Days)",
        helpText:
            "How many days the alert channels keep messages, as set in Slack (1 to 90). For that long the app remembers where each alert quoting a post or comment is, to take the content out if it is deleted on Reddit. Set it to match the channels",
        defaultValue: DEFAULT_SLACK_RETENTION_DAYS,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            retentionProblem(value),
    },
    {
        type: "number",
        name: "modqueueThreshold",
        label: "Modqueue Size Alert Threshold",
        helpText: "Alert when the modqueue holds at least this many items (0 to disable)",
        defaultValue: DEFAULT_MODQUEUE_THRESHOLD,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
    {
        type: "number",
        // Misspelt, but it is the stored setting name.
        name: "unmoderagedAgeHours",
        label: "Unmoderated Content Age Alert (Hours)",
        helpText:
            "Alert when posts/comments have waited this many hours without a moderator reviewing them (0 to disable)",
        defaultValue: DEFAULT_UNMODERATED_AGE_HOURS,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
    {
        type: "number",
        name: "reportedContentAgeHours",
        label: "Old Reported Content Alert (Hours)",
        helpText:
            "Alert when reported posts/comments at least this many hours old are waiting for review (0 to disable)",
        defaultValue: DEFAULT_REPORTED_CONTENT_AGE_HOURS,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
    {
        type: "number",
        name: "spamQueueThreshold",
        label: "Spam Queue Size Alert Threshold",
        helpText: "Alert when Reddit's spam queue holds at least this many items (0 to disable)",
        defaultValue: DEFAULT_SPAM_QUEUE_THRESHOLD,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
    {
        type: "number",
        name: "editedQueueThreshold",
        label: "Edited Queue Size Alert Threshold",
        helpText:
            "Alert when Reddit's edited queue, of recently edited posts and comments, holds at least this many items (0 to disable)",
        defaultValue: DEFAULT_EDITED_QUEUE_THRESHOLD,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
    {
        type: "number",
        name: "modmailWaitHours",
        label: "Modmail Waiting Alert (Hours)",
        helpText:
            "Alert, at most every six hours, when a user has waited this many hours for a reply in modmail, counting ban appeals apart (0 to disable)",
        defaultValue: DEFAULT_MODMAIL_WAIT_HOURS,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
    {
        type: "string",
        name: "urgentReportReasons",
        label: "Urgent Report Reasons",
        helpText:
            "Report reasons that alert the alert channel at once, separated by commas, e.g. personal information, threatening violence. A report alerts when its reason contains one, ignoring case; the alert names the reason as written here, never the report's own words (none by default)",
    },
    {
        type: "number",
        name: "reportPileUpThreshold",
        label: "Report Pile-Up Alert Threshold",
        helpText: "Alert once when a post or comment reaches this many reports (0 to disable)",
        defaultValue: DEFAULT_REPORT_PILE_UP_THRESHOLD,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
    {
        type: "boolean",
        name: "adminModmailAlerts",
        label: "Admin Modmail Alerts",
        helpText:
            "Alert the alert channel at once when a Reddit admin writes to the subreddit's modmail (enabled by default)",
        defaultValue: true,
    },
    {
        type: "number",
        name: "editsAfterApprovalDays",
        label: "Edits After Approval Alert (Days)",
        helpText:
            "Alert when an author edits a post or comment a moderator approved within this many days. The alert shows neither version of the text (0 to disable, at most 30)",
        defaultValue: DEFAULT_EDITS_AFTER_APPROVAL_DAYS,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            approvalDaysProblem(value),
    },
    {
        type: "boolean",
        name: "enableAutoModAlerts",
        label: "Enable AutoModerator Slack Alerts",
        helpText: "Send Slack notifications when AutoModerator performs moderation actions (disabled by default)",
        defaultValue: false,
    },
    {
        type: "number",
        name: "postDeletionUpvoteThreshold",
        label: "Post Deletion Alert Threshold",
        helpText: "Alert when deleted posts had at least this many upvotes (0 to disable)",
        defaultValue: DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
    {
        type: "boolean",
        name: "dailySummary",
        label: "Daily Summary",
        helpText:
            "Post a summary of the day before to Slack each morning at 08:00 UTC: mod actions, alerts, monitor runs and any problems. If it stops arriving, the app has stopped working (off by default)",
        defaultValue: false,
    },
    {
        type: "boolean",
        name: "weeklyStatistics",
        label: "Weekly Statistics",
        helpText:
            "Post the team's statistics for the week before to the notification channel each Monday at 08:00 UTC: actions, who took them, quiet hours, bans, how many moderators acted and the most-moderated threads. No figure names a moderator (off by default)",
        defaultValue: false,
    },
];

/**
 * The settings: the Slack app's bot token, which the developer sets for every installation, then the form moderators
 * fill in, and the validated configuration read from it.
 *
 * Devvit stores the values under these setting names, so renaming one loses what was saved. The form lists the
 * settings in this order.
 */
export function settingsDefinitions(modActions: ModActionChoices): SettingsFormField[] {
    return [
        {
            type: "string",
            name: "slackBotToken",
            label: "Slack Bot Token",
            helpText:
                "The Slack app's Bot User OAuth Token (xoxb-...). The app's developer sets it with `devvit settings set slackBotToken`",
            // An app-wide secret: Devvit encrypts it, and only the developer can set it, from the command line.
            // Moderators never see it.
            scope: "app",
            isSecret: true,
            onValidate: ({ value }: Readonly<{ value?: string | undefined }>): string | undefined =>
                botTokenProblem((value ?? "").trim()),
        },
        {
            type: "select",
            name: "enabledActions",
            label: "Enabled Mod Actions",
            helpText: "Select which mod actions to monitor",
            options: modActions.options.map(({ label, value }): { label: string; value: string } => ({ label, value })),
            multiSelect: true,
            defaultValue: [...modActions.defaults],
        },
        ...OTHER_SETTINGS,
    ];
}
