/**
 * A condition: a problem that lasts, such as alerts having nowhere to go. The app logs one when it starts rather
 * than each time it meets it, as Devvit keeps only 5,000 log entries.
 */
export type Condition =
    | "token-missing"
    | "channel-missing"
    | "slack-refusing"
    | "slack-unreachable"
    | "outbox-full"
    | "alerts-expired"
    | "redactions-failing"
    | "monitor-failing"
    | "modmail-unreadable";

const CONDITION_NAMES: readonly string[] = [
    "token-missing",
    "channel-missing",
    "slack-refusing",
    "slack-unreachable",
    "outbox-full",
    "alerts-expired",
    "redactions-failing",
    "monitor-failing",
    "modmail-unreadable",
];

/** Whether the text names a condition: what Redis holds may come from another version. */
export function isCondition(text: string): text is Condition {
    return CONDITION_NAMES.includes(text);
}

/** A condition in force: since when, in ms since the epoch, and what the app saw of it then. */
export interface InForce {
    readonly condition: Condition;
    readonly since: number;
    readonly detail: string;
}

export type LogLevel = "error" | "warn" | "info";

/** A line for the app's log, at its level. */
export interface LogLine {
    readonly level: LogLevel;
    readonly text: string;
}

interface ConditionText {
    /** What is wrong, in a few words: a modmail notice's subject. */
    readonly title: string;
    readonly level: "error" | "warn";
    /** What is wrong, given what the app last saw of it, and what to do about it. */
    readonly started: (detail: string) => string;
    /** That it is put right. */
    readonly resolved: string;
}

const CONDITIONS: Readonly<Record<Condition, ConditionText>> = {
    "token-missing": {
        title: "Slack isn't connected",
        level: "warn",
        started: (): string =>
            "Slack isn't connected, so no alerts are sent. A moderator connects it with Connect Slack, as the app's README says.",
        resolved: "Slack is connected: alerts are sent again.",
    },
    "channel-missing": {
        title: "No Slack channel is set",
        level: "warn",
        started: (): string =>
            "No Notification Channel is set, so no alerts are sent. Set it in the app's settings to the Slack channel's ID.",
        resolved: "A Notification Channel is set: alerts are sent again.",
    },
    "slack-refusing": {
        title: "Slack is refusing alerts",
        level: "error",
        started: (detail: string): string =>
            `Slack is refusing alerts (${detail}), so they are dropped. Check that the channels in the app's settings are right and the Slack app has been added to them, then use Test Slack Connection. invalid_auth or token_revoked means Slack needs connecting again, with Connect Slack and a new token.`,
        resolved: "Slack is taking alerts again.",
    },
    "slack-unreachable": {
        title: "Slack is not taking alerts",
        level: "warn",
        started: (detail: string): string =>
            `Slack is not taking alerts (${detail}), so they wait in the queue. Alerts are dropped after a day, or beyond 500 waiting.`,
        resolved: "Slack is taking alerts again.",
    },
    "outbox-full": {
        title: "The alert queue is full",
        level: "error",
        started: (): string =>
            "The alert queue is full: 500 alerts are waiting, so the oldest are dropped as new ones come.",
        resolved: "The alert queue has emptied: no more alerts are dropped for want of room.",
    },
    "alerts-expired": {
        title: "Alerts are being dropped after a day",
        level: "error",
        started: (): string => "Alerts are being dropped after waiting a day without reaching Slack.",
        resolved: "The alert queue has emptied: no more alerts are dropped for their age.",
    },
    "redactions-failing": {
        title: "Deleted content is not being taken out of alerts",
        level: "error",
        started: (detail: string): string =>
            `The app could not take a post or comment deleted on Reddit out of an alert in Slack (${detail}), so the alert still quotes it. Check that the Slack app is still in the alert channels; an alert it cannot edit can be deleted in Slack.`,
        resolved: "Deleted content is being taken out of alerts in Slack again.",
    },
    "monitor-failing": {
        title: "The modqueue monitor is failing",
        level: "error",
        started: (detail: string): string =>
            `The modqueue monitor is failing (${detail}), so no modqueue alerts are sent until it recovers.`,
        resolved: "The modqueue monitor is working again.",
    },
    "modmail-unreadable": {
        title: "Modmail cannot be read",
        level: "error",
        started: (detail: string): string =>
            `The app cannot read modmail (${detail}), so modmail from Reddit's admins and modmail waiting for a reply are not alerted.`,
        resolved: "The app can read modmail again.",
    },
};

/** The line that says the condition has ended. */
export function conditionResolved(condition: Condition): LogLine {
    return { level: "info", text: `[health] ${CONDITIONS[condition].resolved}` };
}

/** How often a condition in force is logged again: a day. */
export const REMINDER_SECONDS = 86_400;

/**
 * At most this many characters of what the app saw of a condition are kept. It comes from Reddit, Slack or the
 * network, and goes into the log, modmail notices and Show Bot Status.
 */
const MAX_DETAIL = 200;

/** What the app saw of a condition, as it is kept: at most MAX_DETAIL characters. */
export function keptDetail(detail: string): string {
    return detail.slice(0, MAX_DETAIL);
}

/** The line that says the condition is still in force, `since` ms since the epoch. */
export function conditionContinuing(condition: Condition, detail: string, since: number): LogLine {
    const { level, started } = CONDITIONS[condition];
    return { level, text: `[health] Since ${new Date(since).toISOString()}: ${started(detail)}` };
}

/** What is wrong, in a few words. */
export function conditionTitle(condition: Condition): string {
    return CONDITIONS[condition].title;
}

/** That the condition is put right, without the log's prefix. */
export function resolvedText(condition: Condition): string {
    return CONDITIONS[condition].resolved;
}

/** What the condition is, and what to do about it, without the log's prefix: for the status. */
export function conditionSummary({ condition, detail }: InForce): string {
    return CONDITIONS[condition].started(detail);
}

/** The line that says the condition has started. */
export function conditionStarted(condition: Condition, detail: string): LogLine {
    const { level, started } = CONDITIONS[condition];
    return { level, text: `[health] ${started(detail)}` };
}
