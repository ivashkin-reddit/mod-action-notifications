/**
 * A condition: a problem that lasts, such as alerts having nowhere to go. The app logs one when it starts rather
 * than each time it meets it, as Devvit keeps only 5,000 log entries.
 */
export type Condition =
    | "webhook-missing"
    | "webhook-invalid"
    | "slack-refusing"
    | "slack-unreachable"
    | "outbox-full"
    | "alerts-expired"
    | "monitor-failing";

const CONDITION_NAMES: readonly string[] = [
    "webhook-missing",
    "webhook-invalid",
    "slack-refusing",
    "slack-unreachable",
    "outbox-full",
    "alerts-expired",
    "monitor-failing",
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
    "webhook-missing": {
        title: "No Slack webhook URL is set",
        level: "warn",
        started: (): string => "No Slack webhook URL is set, so no alerts are sent. Set one in the app's settings.",
        resolved: "A Slack webhook URL is set: alerts are sent again.",
    },
    "webhook-invalid": {
        title: "The Slack webhook URL is not a Slack one",
        level: "error",
        started: (): string =>
            "The Slack webhook URL is not an https://hooks.slack.com/ URL, so no alerts are sent. Correct it in the app's settings.",
        resolved: "The Slack webhook URL is a Slack one: alerts are sent again.",
    },
    "slack-refusing": {
        title: "Slack is refusing alerts",
        level: "error",
        started: (detail: string): string =>
            `Slack is refusing alerts (${detail}), so they are dropped. Check the webhook URL in the app's settings, then use Test Slack Connection.`,
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
    "monitor-failing": {
        title: "The modqueue monitor is failing",
        level: "error",
        started: (detail: string): string =>
            `The modqueue monitor is failing (${detail}), so no modqueue alerts are sent until it recovers.`,
        resolved: "The modqueue monitor is working again.",
    },
};

/** The line that says the condition has ended. */
export function conditionResolved(condition: Condition): LogLine {
    return { level: "info", text: `[health] ${CONDITIONS[condition].resolved}` };
}

/** How often a condition in force is logged again: a day. */
export const REMINDER_SECONDS = 86_400;

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
