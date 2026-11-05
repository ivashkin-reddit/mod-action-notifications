/** The settings as the app reads them: each saved value parsed, as Devvit checks none it returns. */
import {
    DEFAULT_MODQUEUE_THRESHOLD,
    DEFAULT_UNMODERATED_AGE_HOURS,
    DEFAULT_REPORTED_CONTENT_AGE_HOURS,
    DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
    webhookUrlProblem,
} from "./definitions.js";

const DECIMAL = 10;

/** The installation's settings, validated. */
export interface AppConfig {
    /** An https://hooks.slack.com/ URL, or '' when none is set or the one set is not one. */
    readonly slackWebhookUrl: string;
    /** True when the URL set is not an https://hooks.slack.com/ URL: one saved before the app checked on saving. */
    readonly slackWebhookUrlInvalid: boolean;
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

// Devvit's client lets a caller name the type a setting comes back as, but checks nothing: a saved value can be
// anything, so each is read as unknown and parsed. Devvit's client satisfies this.
type SettingsReader = Readonly<{ get: (name: string) => Promise<unknown> }>;
type SettingValue = unknown;

/** What the app uses until it first reads the settings. */
const DEFAULT_CONFIG: AppConfig = {
    slackWebhookUrl: "",
    slackWebhookUrlInvalid: false,
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

/** The webhook setting: an https Slack webhook URL, or '' and whether what was set is not one. */
function webhookSetting(value: SettingValue): Pick<AppConfig, "slackWebhookUrl" | "slackWebhookUrlInvalid"> {
    const url = typeof value === "string" ? value.trim() : "";
    const invalid = webhookUrlProblem(url) !== undefined;
    return { slackWebhookUrl: invalid ? "" : url, slackWebhookUrlInvalid: invalid };
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
        ...webhookSetting(await settings.get("slackWebhookUrl")),
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
            const last = lastRead.get(installation);
            if (last === undefined) {
                // The defaults set no webhook: nothing is sent until the settings can be read.
                console.error(
                    "[settings] Could not read the settings, so no alerts are sent until they can be:",
                    error,
                );
                return DEFAULT_CONFIG;
            }
            console.warn("[settings] Could not read the settings, so using those last read:", error);
            return last;
        }
    };
}
