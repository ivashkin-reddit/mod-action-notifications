import type { SettingsFormField, TriggerContext } from "@devvit/public-api";

const DEFAULT_MODQUEUE_THRESHOLD = 50;
const DEFAULT_UNMODERATED_AGE_HOURS = 24;
const DEFAULT_REPORTED_CONTENT_AGE_HOURS = 24;
const DEFAULT_POST_DELETION_UPVOTE_THRESHOLD = 100;
const DECIMAL = 10;
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
function webhookUrlProblem(text: string): string | undefined {
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
        helpText: "Separate channel for unknown moderator alerts (optional, uses main channel if empty)",
    },
    {
        type: "number",
        name: "modqueueThreshold",
        label: "Modqueue Size Alert Threshold",
        helpText: "Send alert when modqueue exceeds this many items (0 to disable)",
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

/** The installation's settings, validated. */
export interface AppConfig {
    /** An https://hooks.slack.com/ URL, or '' when none is set or the one set is not one. */
    readonly slackWebhookUrl: string;
    readonly enabledActions: readonly string[];
    /** Lower-cased usernames, from the comma-separated setting. */
    readonly excludedModerators: readonly string[];
    readonly flagUnknownModerators: boolean;
    readonly includeModNote: boolean;
    /** A channel name without its leading #, or '' for the webhook's own channel. */
    readonly notificationChannel: string;
    /** A channel name without its leading #: the alert channel, else the notification channel, else ''. */
    readonly alertChannel: string;
    /** 0 turns the queue-size alert off. */
    readonly modqueueThreshold: number;
    /** 0 turns the unmoderated-age alert off. */
    readonly unmoderatedAgeHours: number;
    /** 0 turns the old-reported-content alert off. */
    readonly reportedContentAgeHours: number;
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
    excludedModerators: [],
    flagUnknownModerators: true,
    includeModNote: true,
    notificationChannel: "",
    alertChannel: "",
    modqueueThreshold: DEFAULT_MODQUEUE_THRESHOLD,
    unmoderatedAgeHours: DEFAULT_UNMODERATED_AGE_HOURS,
    reportedContentAgeHours: DEFAULT_REPORTED_CONTENT_AGE_HOURS,
    enableAutoModAlerts: false,
    postDeletionUpvoteThreshold: DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
};

/** An https Slack webhook URL, or '' (logging an error for a setting saved before it was checked on saving). */
function webhookUrl(value: SettingValue): string {
    const url = typeof value === "string" ? value.trim() : "";
    if (webhookUrlProblem(url) === undefined) {
        return url;
    }
    console.error("Invalid Slack webhook URL: must be an https://hooks.slack.com/ URL");
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

/** The names in comma-separated text, trimmed and lower-cased, leaving out blanks. */
function usernames(value: SettingValue): readonly string[] {
    return typeof value === "string"
        ? value
              .split(",")
              .map((name: string): string => name.trim().toLowerCase())
              .filter((name: string): boolean => name !== "")
        : [];
}

async function readConfig(settings: SettingsReader): Promise<AppConfig> {
    // Read one after another: a setting that cannot be read stops the rest.
    const notificationChannel = channelName(await settings.get("notificationChannel"));
    const alertChannel = channelName(await settings.get("alertChannel"));
    return {
        slackWebhookUrl: webhookUrl(await settings.get("slackWebhookUrl")),
        enabledActions: selected(await settings.get("enabledActions")),
        excludedModerators: usernames(await settings.get("excludedModerators")),
        flagUnknownModerators: booleanOr(await settings.get("flagUnknownModerators"), true),
        includeModNote: booleanOr(await settings.get("includeModNote"), true),
        notificationChannel,
        // The setting's help text: "uses main channel if empty".
        alertChannel: alertChannel === "" ? notificationChannel : alertChannel,
        modqueueThreshold: nonNegativeInteger(await settings.get("modqueueThreshold"), DEFAULT_MODQUEUE_THRESHOLD),
        unmoderatedAgeHours: nonNegativeInteger(
            await settings.get("unmoderagedAgeHours"),
            DEFAULT_UNMODERATED_AGE_HOURS,
        ),
        reportedContentAgeHours: nonNegativeInteger(
            await settings.get("reportedContentAgeHours"),
            DEFAULT_REPORTED_CONTENT_AGE_HOURS,
        ),
        enableAutoModAlerts: booleanOr(await settings.get("enableAutoModAlerts"), false),
        postDeletionUpvoteThreshold: nonNegativeInteger(
            await settings.get("postDeletionUpvoteThreshold"),
            DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
        ),
    };
}

/** Reads one installation's settings; `installation` names it (its subreddit ID). */
export type ConfigLoader = (settings: SettingsReader, installation: string) => Promise<AppConfig>;

/**
 * Returns a loader that reads and validates the settings each time it is called. When they cannot be read, it
 * logs and returns the configuration it last read for that installation (the defaults, before the first successful
 * read). One app process can serve several installations, so one's settings, webhook URL included, must never
 * stand in for another's.
 */
export function createConfigLoader(): ConfigLoader {
    const lastRead = new Map<string, AppConfig>();
    return async (settings: SettingsReader, installation: string): Promise<AppConfig> => {
        try {
            const config = await readConfig(settings);
            lastRead.set(installation, config);
            return config;
        } catch (error) {
            console.error("Failed to load configuration - check settings format and values:", error);
            return lastRead.get(installation) ?? DEFAULT_CONFIG;
        }
    };
}
