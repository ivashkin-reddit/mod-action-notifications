import type { SettingsFormField, TriggerContext } from "@devvit/public-api";

const DEFAULT_MODQUEUE_THRESHOLD = 50;
const DEFAULT_UNMODERATED_AGE_HOURS = 24;
const DEFAULT_POST_DELETION_UPVOTE_THRESHOLD = 100;
const DECIMAL = 10;

/**
 * Installation settings: the form moderators fill in, and the validated configuration read from it.
 *
 * Devvit stores each installation's values under these setting names, so renaming one loses what moderators
 * saved. The form lists the settings in this order.
 */
export const settingsDefinitions: SettingsFormField[] = [
    {
        type: "string",
        name: "slackWebhookUrl",
        label: "Slack Webhook URL",
        helpText: "The Slack webhook URL to send mod action notifications to",
    },
    {
        type: "select",
        name: "enabledActions",
        label: "Enabled Mod Actions",
        helpText: "Select which mod actions to monitor",
        options: [
            { label: "Remove Post", value: "removelink" },
            { label: "Remove Comment", value: "removecomment" },
            { label: "Spam Post", value: "spamlink" },
            { label: "Spam Comment", value: "spamcomment" },
            { label: "Approve Post", value: "approvelink" },
            { label: "Approve Comment", value: "approvecomment" },
            { label: "Ban User", value: "banuser" },
            { label: "Unban User", value: "unbanuser" },
            { label: "Lock Post", value: "lock" },
            { label: "Unlock Post", value: "unlock" },
            { label: "Sticky Post", value: "sticky" },
            { label: "Unsticky Post", value: "unsticky" },
            { label: "Edit Flair", value: "editflair" },
            { label: "Mute User", value: "muteuser" },
            { label: "Unmute User", value: "unmuteuser" },
            { label: "Distinguish Post/Comment", value: "distinguish" },
            { label: "Ignore Reports", value: "ignorereports" },
            { label: "Unignore Reports", value: "unignorereports" },
            { label: "Snooze Reports", value: "snoozereports" },
            { label: "Unsnooze Reports", value: "unsnoozereports" },
            { label: "Add Approved User", value: "addcontributor" },
            { label: "Remove Approved User", value: "removecontributor" },
            { label: "Invite Moderator", value: "invitemoderator" },
            { label: "Uninvite Moderator", value: "uninvitemoderator" },
            { label: "Accept Moderator Invite", value: "acceptmoderatorinvite" },
            { label: "Add Moderator", value: "addmoderator" },
            { label: "Remove Moderator", value: "removemoderator" },
            { label: "Edit Settings", value: "editsettings" },
            { label: "Adjust Crowd Control Level", value: "adjust_post_crowd_control_level" },
            { label: "Enable Crowd Control Filter", value: "enable_post_crowd_control_filter" },
            { label: "Disable Crowd Control Filter", value: "disable_post_crowd_control_filter" },
        ],
        multiSelect: true,
        defaultValue: ["removelink", "removecomment", "spamlink", "spamcomment", "banuser", "unbanuser"],
    },
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
        helpText: "Separate channel for unknown moderator alerts (optional, uses main channel if empty)",
    },
    {
        type: "number",
        name: "modqueueThreshold",
        label: "Modqueue Size Alert Threshold",
        helpText: "Send alert when modqueue exceeds this many items (0 to disable)",
        defaultValue: DEFAULT_MODQUEUE_THRESHOLD,
    },
    {
        type: "number",
        // Misspelt, but it is the stored setting name.
        name: "unmoderagedAgeHours",
        label: "Unmoderated Post Age Alert (Hours)",
        helpText: "Alert when posts/comments remain unmoderated for this many hours (0 to disable)",
        defaultValue: DEFAULT_UNMODERATED_AGE_HOURS,
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
    },
];

/** The installation's settings, validated. */
export interface AppConfig {
    /** An https URL, or '' when none is set or the one set is not https. */
    readonly slackWebhookUrl: string;
    readonly enabledActions: readonly string[];
    /** Comma-separated usernames. */
    readonly excludedModerators: string;
    readonly flagUnknownModerators: boolean;
    readonly includeModNote: boolean;
    /** A channel name without its leading #, or '' for the webhook's own channel. */
    readonly notificationChannel: string;
    /** A channel name without its leading #, or ''. */
    readonly alertChannel: string;
    /** 0 turns the queue-size alert off. */
    readonly modqueueThreshold: number;
    /** 0 turns the unmoderated-age alert off. */
    readonly unmoderatedAgeHours: number;
    readonly enableAutoModAlerts: boolean;
    /** 0 turns deleted-post alerts off. */
    readonly postDeletionUpvoteThreshold: number;
}

type SettingsReader = Readonly<Pick<TriggerContext["settings"], "get">>;
type SettingValue = Awaited<ReturnType<SettingsReader["get"]>>;

/** What the app uses until it first reads the settings. */
const DEFAULT_CONFIG: AppConfig = {
    slackWebhookUrl: "",
    enabledActions: [],
    excludedModerators: "",
    flagUnknownModerators: true,
    includeModNote: true,
    notificationChannel: "",
    alertChannel: "",
    modqueueThreshold: DEFAULT_MODQUEUE_THRESHOLD,
    unmoderatedAgeHours: DEFAULT_UNMODERATED_AGE_HOURS,
    enableAutoModAlerts: false,
    postDeletionUpvoteThreshold: DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
};

/** An https URL, or '' (logging an error when the setting is not https). */
function webhookUrl(value: SettingValue): string {
    const url = typeof value === "string" ? value.trim() : "";
    if (url === "" || url.startsWith("https://")) {
        return url;
    }
    console.error("Invalid Slack webhook URL: must start with https://");
    return "";
}

/** A trimmed channel name without leading #s, or ''. */
function channelName(value: SettingValue): string {
    return typeof value === "string" ? value.trim().replace(/^#+/u, "") : "";
}

/** A whole number of at least 0, read from a number or numeric text; `fallback` for anything else. */
function nonNegativeInteger(value: SettingValue, fallback: number): number {
    if (typeof value === "number") {
        return Math.max(0, Math.floor(value));
    }
    if (typeof value !== "string") {
        return fallback;
    }
    const parsed = Number.parseInt(value, DECIMAL);
    return Number.isNaN(parsed) ? fallback : Math.max(0, parsed);
}

function booleanOr(value: SettingValue, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/** The values a multi-select setting holds (Devvit stores them as strings), or none. */
function selected(value: SettingValue): readonly string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function text(value: SettingValue): string {
    return typeof value === "string" ? value : "";
}

async function readConfig(settings: SettingsReader): Promise<AppConfig> {
    // Read one after another: a setting that cannot be read stops the rest.
    return {
        slackWebhookUrl: webhookUrl(await settings.get("slackWebhookUrl")),
        enabledActions: selected(await settings.get("enabledActions")),
        excludedModerators: text(await settings.get("excludedModerators")),
        flagUnknownModerators: booleanOr(await settings.get("flagUnknownModerators"), true),
        includeModNote: booleanOr(await settings.get("includeModNote"), true),
        notificationChannel: channelName(await settings.get("notificationChannel")),
        alertChannel: channelName(await settings.get("alertChannel")),
        modqueueThreshold: nonNegativeInteger(await settings.get("modqueueThreshold"), DEFAULT_MODQUEUE_THRESHOLD),
        unmoderatedAgeHours: nonNegativeInteger(
            await settings.get("unmoderagedAgeHours"),
            DEFAULT_UNMODERATED_AGE_HOURS,
        ),
        enableAutoModAlerts: booleanOr(await settings.get("enableAutoModAlerts"), false),
        postDeletionUpvoteThreshold: nonNegativeInteger(
            await settings.get("postDeletionUpvoteThreshold"),
            DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
        ),
    };
}

/**
 * Returns a loader that reads and validates the settings each time it is called. When they cannot be read, it
 * logs and returns the configuration it last read (the defaults, before the first successful read).
 */
export function createConfigLoader(): (settings: SettingsReader) => Promise<AppConfig> {
    let config = DEFAULT_CONFIG;
    return async (settings: SettingsReader): Promise<AppConfig> => {
        try {
            config = await readConfig(settings);
        } catch (error) {
            console.error("Failed to load configuration - check settings format and values:", error);
        }
        return config;
    };
}
