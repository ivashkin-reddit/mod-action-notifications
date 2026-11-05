import { conditionSummary, conditionTitle, resolvedText } from "./conditions.js";
import type { Condition, InForce } from "./conditions.js";

/** A message for the subreddit's modmail: a notification moderators see whether or not Slack works. */
export interface Notice {
    readonly subject: string;
    readonly body: string;
}

/** A condition is sent to modmail at most once in this long. */
export const NOTICE_PERIOD_SECONDS = 86_400;

/** Long enough for a problem that often passes by itself to have shown it will not: half an hour. */
const LASTING_MS = 1_800_000;

/**
 * How long each condition lasts before moderators are told: at once when alerts are lost or not sent, after 30
 * minutes for a problem that often passes by itself, and never for a missing bot token or channel, which are set up
 * with the app, or for an alert left quoting deleted content, which Show Bot Status and the log report.
 */
const NOTICE_AFTER_MS: Readonly<Record<Condition, number | undefined>> = {
    "token-missing": undefined,
    "channel-missing": undefined,
    "slack-refusing": 0,
    "slack-unreachable": LASTING_MS,
    "outbox-full": 0,
    "alerts-expired": 0,
    "redactions-failing": undefined,
    "monitor-failing": LASTING_MS,
};

/** Whether moderators should be told of a condition in force since `since`, at `now`, both ms since the epoch. */
export function noticeDue(condition: Condition, since: number, now: number): boolean {
    const after = NOTICE_AFTER_MS[condition];
    return after !== undefined && now - since >= after;
}

const MINUTE_LENGTH = 16;

/** An instant to the minute, in UTC: 2026-11-04 12:00 UTC. */
function minuteOf(ms: number): string {
    return `${new Date(ms).toISOString().slice(0, MINUTE_LENGTH).replace("T", " ")} UTC`;
}

export function problemNotice(problem: InForce): Notice {
    return {
        subject: `Mod Action Notifications: ${conditionTitle(problem.condition)}`,
        body: [
            conditionSummary(problem),
            `This started at ${minuteOf(problem.since)}. **Show Bot Status**, in the subreddit's mod tools, shows how the bot is doing now.`,
            "_The bot sends this at most once a day for each problem, and says when it is over._",
        ].join("\n\n"),
    };
}

export function resolvedNotice(condition: Condition): Notice {
    return {
        subject: `Mod Action Notifications: resolved: ${conditionTitle(condition)}`,
        body: resolvedText(condition),
    };
}
