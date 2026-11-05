import type { SettingsFormField } from "@devvit/public-api";

/** The settings moderators fill in, with what each is checked for on saving. */

export const DEFAULT_MODQUEUE_THRESHOLD = 50;
export const DEFAULT_UNMODERATED_AGE_HOURS = 24;
export const DEFAULT_REPORTED_CONTENT_AGE_HOURS = 24;
export const DEFAULT_POST_DELETION_UPVOTE_THRESHOLD = 100;
/** The only host the app may fetch (devvit.json permissions.http.domains): a Slack incoming webhook's. */
const SLACK_WEBHOOK_HOST = "hooks.slack.com";
const WEBHOOK_URL_PROBLEM = "Enter a Slack incoming webhook URL, starting https://hooks.slack.com/";
const WHOLE_NUMBER_PROBLEM = "Enter a whole number, 0 or more (0 turns this alert off)";

/** The text as a URL, or undefined when it is not one. */
function urlOf(text: string): URL | undefined {
    try {
        return new URL(text);
    } catch {
        // Not a URL: what a moderator typed, which the caller reports.
        return undefined;
    }
}

/** Why the text cannot be the webhook URL, or undefined when it can: blank (no alerts) or an https Slack webhook. */
export function webhookUrlProblem(text: string): string | undefined {
    if (text === "") {
        return undefined;
    }
    const url = urlOf(text);
    return url?.protocol === "https:" && url.hostname === SLACK_WEBHOOK_HOST ? undefined : WEBHOOK_URL_PROBLEM;
}

/** Why the value cannot be a threshold, or undefined when it can: unset (the default) or a whole number of 0 or more. */
function wholeNumberProblem(value: number | undefined): string | undefined {
    return value === undefined || (Number.isInteger(value) && value >= 0) ? undefined : WHOLE_NUMBER_PROBLEM;
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
        name: "includeModNote",
        label: "Include Mod Note",
        helpText: "Include moderator notes in Slack notifications",
        defaultValue: true,
    },
    {
        type: "string",
        name: "notificationChannel",
        label: "Notification Channel",
        helpText: "Slack channel name (optional, uses webhook default if empty)",
    },
    {
        type: "string",
        name: "alertChannel",
        label: "Alert Channel",
        helpText:
            "Channel for security, modqueue and deleted-post alerts (optional; uses the notification channel if empty)",
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
];

/**
 * Installation settings: the form moderators fill in, and the validated configuration read from it.
 *
 * Devvit stores each installation's values under these setting names, so renaming one loses what moderators
 * saved. The form lists the settings in this order.
 */
export function settingsDefinitions(modActions: ModActionChoices): SettingsFormField[] {
    return [
        {
            type: "string",
            name: "slackWebhookUrl",
            label: "Slack Webhook URL",
            helpText: "The Slack incoming webhook URL to send notifications to (https://hooks.slack.com/...)",
            onValidate: ({ value }: Readonly<{ value?: string | undefined }>): string | undefined =>
                webhookUrlProblem((value ?? "").trim()),
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
