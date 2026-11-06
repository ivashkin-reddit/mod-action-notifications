import type { SettingsFormField } from "@devvit/public-api";

/** The settings moderators fill in, with what each is checked for on saving. */

export const DEFAULT_MODQUEUE_THRESHOLD = 50;
export const DEFAULT_UNMODERATED_AGE_HOURS = 24;
export const DEFAULT_REPORTED_CONTENT_AGE_HOURS = 24;
export const DEFAULT_POST_DELETION_UPVOTE_THRESHOLD = 100;
/** The free Slack plan's only retention short of a year. */
export const DEFAULT_SLACK_RETENTION_DAYS = 90;
/** The app takes deleted content out of an alert for at most 90 days, so it remembers where alerts are no longer. */
export const MAX_SLACK_RETENTION_DAYS = 90;
/** A Slack bot token starts so; a user token (xoxp-) would post as the person who made it. */
const BOT_TOKEN_PREFIX = "xoxb-";
const BOT_TOKEN_PROBLEM = "Enter the Slack app's Bot User OAuth Token, starting xoxb-";
const WHOLE_NUMBER_PROBLEM = "Enter a whole number, 0 or more (0 turns this alert off)";
const RETENTION_PROBLEM = "Enter a whole number of days, from 1 to 90";

/** Why the text cannot be the bot token, or undefined when it can: blank (no alerts) or a Slack bot token. */
function botTokenProblem(text: string): string | undefined {
    return text === "" || text.startsWith(BOT_TOKEN_PREFIX) ? undefined : BOT_TOKEN_PROBLEM;
}

/** Why the value cannot be a threshold, or undefined when it can: unset (the default) or a whole number of 0 or more. */
function wholeNumberProblem(value: number | undefined): string | undefined {
    return value === undefined || (Number.isInteger(value) && value >= 0) ? undefined : WHOLE_NUMBER_PROBLEM;
}

/** Why the value cannot be the channels' retention, or undefined when it can: unset (the default) or 1 to 90 days. */
function retentionProblem(value: number | undefined): string | undefined {
    return value === undefined || (Number.isInteger(value) && value >= 1 && value <= MAX_SLACK_RETENTION_DAYS)
        ? undefined
        : RETENTION_PROBLEM;
}

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
            "Always send changes to the mod team (moderators added, removed or invited, permissions changed) and to Devvit apps (installed, removed, enabled, disabled or changed) as security alerts to the alert channel, whatever Enabled Mod Actions and Excluded Moderators say",
        defaultValue: true,
    },
    {
        type: "boolean",
        name: "includeModNote",
        label: "Include Mod Note",
        helpText: "Include moderator notes in Slack notifications",
        defaultValue: true,
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
