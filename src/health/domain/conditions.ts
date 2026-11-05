/**
 * A condition: a problem that lasts, such as alerts having nowhere to go. The app logs one when it starts rather
 * than each time it meets it, as Devvit keeps only 5,000 log entries.
 */
export type Condition = "webhook-missing" | "webhook-invalid" | "slack-refusing" | "slack-unreachable";

export type LogLevel = "error" | "warn" | "info";

/** A line for the app's log, at its level. */
export interface LogLine {
    readonly level: LogLevel;
    readonly text: string;
}

interface ConditionText {
    readonly level: "error" | "warn";
    /** What is wrong, given what the app last saw of it, and what to do about it. */
    readonly started: (detail: string) => string;
    /** That it is put right. */
    readonly resolved: string;
}

const CONDITIONS: Readonly<Record<Condition, ConditionText>> = {
    "webhook-missing": {
        level: "warn",
        started: (): string => "No Slack webhook URL is set, so no alerts are sent. Set one in the app's settings.",
        resolved: "A Slack webhook URL is set: alerts are sent again.",
    },
    "webhook-invalid": {
        level: "error",
        started: (): string =>
            "The Slack webhook URL is not an https://hooks.slack.com/ URL, so no alerts are sent. Correct it in the app's settings.",
        resolved: "The Slack webhook URL is a Slack one: alerts are sent again.",
    },
    "slack-refusing": {
        level: "error",
        started: (detail: string): string =>
            `Slack is refusing alerts (${detail}), so they are dropped. Check the webhook URL in the app's settings, then use Test Slack Connection.`,
        resolved: "Slack is taking alerts again.",
    },
    "slack-unreachable": {
        level: "warn",
        started: (detail: string): string =>
            `Slack is not taking alerts (${detail}), so they wait in the queue. Alerts are dropped after a day, or beyond 500 waiting.`,
        resolved: "Slack is taking alerts again.",
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

/** The line that says the condition has started. */
export function conditionStarted(condition: Condition, detail: string): LogLine {
    const { level, started } = CONDITIONS[condition];
    return { level, text: `[health] ${started(detail)}` };
}
