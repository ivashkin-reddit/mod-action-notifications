/** The settings as the app reads them: each saved value parsed, as Devvit checks none it returns. */
import {
    DEFAULT_MODQUEUE_THRESHOLD,
    DEFAULT_UNMODERATED_AGE_HOURS,
    DEFAULT_REPORTED_CONTENT_AGE_HOURS,
    DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
    DEFAULT_SPAM_QUEUE_THRESHOLD,
    DEFAULT_BAN_HISTORY_DAYS,
    DEFAULT_DORMANT_MODERATOR_DAYS,
    DEFAULT_EDITED_QUEUE_THRESHOLD,
    DEFAULT_EDITS_AFTER_APPROVAL_DAYS,
    DEFAULT_MODMAIL_WAIT_HOURS,
    DEFAULT_REPORT_PILE_UP_THRESHOLD,
    DEFAULT_SLACK_RETENTION_DAYS,
} from "./definitions.js";
import { MAX_SLACK_RETENTION_DAYS } from "./validation.js";

const DECIMAL = 10;

/** The installation's settings, validated. */
export interface AppConfig {
    readonly enabledActions: readonly string[];
    /** Log a completion line for every invocation, not only for failed and slow ones. */
    readonly debugLogging: boolean;
    /** Lower-cased usernames, from the comma-separated setting. */
    readonly excludedModerators: readonly string[];
    readonly flagUnknownModerators: boolean;
    /** Send every security action as a security alert. */
    readonly securityAlerts: boolean;
    /** A moderator's first action after this many days is a security alert; 0 turns it off. */
    readonly dormantModeratorDays: number;
    readonly includeModNote: boolean;
    /** How many days of the banned user's mod notes a ban alert counts; 0 leaves them out. */
    readonly banHistoryDays: number;
    /** A channel ID, or a channel name without its leading #; '' when none is set, so no alerts can be sent. */
    readonly notificationChannel: string;
    /** A channel ID or name without its leading #: the alert channel, else the notification channel, else ''. */
    readonly alertChannel: string;
    /** How many days the alert channels keep messages, 1 to 90: how long the app remembers where its alerts are. */
    readonly slackRetentionDays: number;
    /** 0 turns the queue-size alert off. */
    readonly modqueueThreshold: number;
    /** 0 turns the unmoderated-age alert off. */
    readonly unmoderatedAgeHours: number;
    /** 0 turns the old-reported-content alert off. */
    readonly reportedContentAgeHours: number;
    /** 0 turns the spam queue alert off. */
    readonly spamQueueThreshold: number;
    /** 0 turns the edited queue alert off. */
    readonly editedQueueThreshold: number;
    /** Hours a user waits for a reply in modmail before it alerts; 0 turns the alert off. */
    readonly modmailWaitHours: number;
    /** Report reasons that alert at once, as moderators wrote them, from the comma-separated setting. */
    readonly urgentReportReasons: readonly string[];
    /** 0 turns the report pile-up alert off. */
    readonly reportPileUpThreshold: number;
    /** Whether a Reddit admin's modmail alerts at once. */
    readonly adminModmailAlerts: boolean;
    /** An author's edit within this many days of a moderator's approval alerts; 0 turns it off. */
    readonly editsAfterApprovalDays: number;
    readonly enableAutoModAlerts: boolean;
    /** 0 turns deleted-post alerts off. */
    readonly postDeletionUpvoteThreshold: number;
    /** Whether a summary of the day before goes to Slack each morning. */
    readonly dailySummary: boolean;
    /** Whether the team's statistics for the week before go to Slack each Monday. */
    readonly weeklyStatistics: boolean;
}

// Devvit's client lets a caller name the type a setting comes back as, but checks nothing: a saved value can be
// anything, so each is read as unknown and parsed. Devvit's client satisfies this.
type SettingsReader = Readonly<{ get: (name: string) => Promise<unknown> }>;
type SettingValue = unknown;

/** What the app uses until it first reads the settings. */
const DEFAULT_CONFIG: AppConfig = {
    enabledActions: [],
    debugLogging: false,
    excludedModerators: [],
    flagUnknownModerators: true,
    securityAlerts: true,
    dormantModeratorDays: DEFAULT_DORMANT_MODERATOR_DAYS,
    includeModNote: true,
    banHistoryDays: DEFAULT_BAN_HISTORY_DAYS,
    notificationChannel: "",
    alertChannel: "",
    slackRetentionDays: DEFAULT_SLACK_RETENTION_DAYS,
    modqueueThreshold: DEFAULT_MODQUEUE_THRESHOLD,
    unmoderatedAgeHours: DEFAULT_UNMODERATED_AGE_HOURS,
    reportedContentAgeHours: DEFAULT_REPORTED_CONTENT_AGE_HOURS,
    spamQueueThreshold: DEFAULT_SPAM_QUEUE_THRESHOLD,
    editedQueueThreshold: DEFAULT_EDITED_QUEUE_THRESHOLD,
    modmailWaitHours: DEFAULT_MODMAIL_WAIT_HOURS,
    urgentReportReasons: [],
    reportPileUpThreshold: DEFAULT_REPORT_PILE_UP_THRESHOLD,
    adminModmailAlerts: true,
    editsAfterApprovalDays: DEFAULT_EDITS_AFTER_APPROVAL_DAYS,
    enableAutoModAlerts: false,
    postDeletionUpvoteThreshold: DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
    dailySummary: false,
    weeklyStatistics: false,
};

function trimmed(value: SettingValue): string {
    return typeof value === "string" ? value.trim() : "";
}

/** A trimmed channel ID, or channel name without leading #s, or ''. */
function channelName(value: SettingValue): string {
    return trimmed(value).replace(/^#+/u, "");
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

/** Days from 1 to 90, read as a whole number; the default for anything else. */
function retentionDays(value: SettingValue): number {
    return Math.min(MAX_SLACK_RETENTION_DAYS, Math.max(1, nonNegativeInteger(value, DEFAULT_SLACK_RETENTION_DAYS)));
}

function booleanOr(value: SettingValue, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}

/** The values a multi-select setting holds (Devvit stores them as strings), or none. */
function selected(value: SettingValue): readonly string[] {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** The entries of comma-separated text, trimmed, leaving out blanks. */
function commaList(value: SettingValue): readonly string[] {
    return typeof value === "string"
        ? value
              .split(",")
              .map((entry: string): string => entry.trim())
              .filter((entry: string): boolean => entry !== "")
        : [];
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

/** The settings of the alerts on what the community does: modmail, reports and edits after approval. */
type CommunityAlerts = Pick<
    AppConfig,
    | "modmailWaitHours"
    | "urgentReportReasons"
    | "reportPileUpThreshold"
    | "adminModmailAlerts"
    | "editsAfterApprovalDays"
>;

async function readCommunityAlerts(settings: SettingsReader): Promise<CommunityAlerts> {
    return {
        modmailWaitHours: nonNegativeInteger(await settings.get("modmailWaitHours"), DEFAULT_MODMAIL_WAIT_HOURS),
        urgentReportReasons: commaList(await settings.get("urgentReportReasons")),
        reportPileUpThreshold: nonNegativeInteger(
            await settings.get("reportPileUpThreshold"),
            DEFAULT_REPORT_PILE_UP_THRESHOLD,
        ),
        adminModmailAlerts: booleanOr(await settings.get("adminModmailAlerts"), true),
        editsAfterApprovalDays: nonNegativeInteger(
            await settings.get("editsAfterApprovalDays"),
            DEFAULT_EDITS_AFTER_APPROVAL_DAYS,
        ),
    };
}

async function readConfig(settings: SettingsReader): Promise<AppConfig> {
    // Read one after another: a setting that cannot be read stops the rest.
    const notificationChannel = channelName(await settings.get("notificationChannel"));
    const alertChannel = channelName(await settings.get("alertChannel"));
    return {
        enabledActions: selected(await settings.get("enabledActions")),
        debugLogging: booleanOr(await settings.get("debugLogging"), false),
        excludedModerators: usernames(await settings.get("excludedModerators")),
        flagUnknownModerators: booleanOr(await settings.get("flagUnknownModerators"), true),
        securityAlerts: booleanOr(await settings.get("securityAlerts"), true),
        dormantModeratorDays: nonNegativeInteger(
            await settings.get("dormantModeratorDays"),
            DEFAULT_DORMANT_MODERATOR_DAYS,
        ),
        includeModNote: booleanOr(await settings.get("includeModNote"), true),
        banHistoryDays: nonNegativeInteger(await settings.get("banHistoryDays"), DEFAULT_BAN_HISTORY_DAYS),
        notificationChannel,
        // The setting's help text: "uses main channel if empty".
        alertChannel: alertChannel === "" ? notificationChannel : alertChannel,
        slackRetentionDays: retentionDays(await settings.get("slackRetentionDays")),
        modqueueThreshold: nonNegativeInteger(await settings.get("modqueueThreshold"), DEFAULT_MODQUEUE_THRESHOLD),
        unmoderatedAgeHours: nonNegativeInteger(
            await settings.get("unmoderagedAgeHours"),
            DEFAULT_UNMODERATED_AGE_HOURS,
        ),
        reportedContentAgeHours: nonNegativeInteger(
            await settings.get("reportedContentAgeHours"),
            DEFAULT_REPORTED_CONTENT_AGE_HOURS,
        ),
        spamQueueThreshold: nonNegativeInteger(await settings.get("spamQueueThreshold"), DEFAULT_SPAM_QUEUE_THRESHOLD),
        editedQueueThreshold: nonNegativeInteger(
            await settings.get("editedQueueThreshold"),
            DEFAULT_EDITED_QUEUE_THRESHOLD,
        ),
        ...(await readCommunityAlerts(settings)),
        enableAutoModAlerts: booleanOr(await settings.get("enableAutoModAlerts"), false),
        dailySummary: booleanOr(await settings.get("dailySummary"), false),
        weeklyStatistics: booleanOr(await settings.get("weeklyStatistics"), false),
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
 * read). One app process can serve several installations, so one's settings, channels included, must never stand
 * in for another's.
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
                // The defaults name no channel: nothing is sent until the settings can be read.
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
