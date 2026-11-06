/** What each setting is checked for on saving: each function says why a value cannot be saved, or undefined when it can. */

/** The app takes deleted content out of an alert for at most 90 days, so it remembers where alerts are no longer. */
export const MAX_SLACK_RETENTION_DAYS = 90;
/** A Slack bot token starts so; a user token (xoxp-) would post as the person who made it. */
const BOT_TOKEN_PREFIX = "xoxb-";
const BOT_TOKEN_PROBLEM = "Enter the Slack app's Bot User OAuth Token, starting xoxb-";
const WHOLE_NUMBER_PROBLEM = "Enter a whole number, 0 or more (0 turns this alert off)";
const RETENTION_PROBLEM = "Enter a whole number of days, from 1 to 90";
const HISTORY_DAYS_PROBLEM = "Enter a whole number of days, 0 or more (0 leaves the history out)";
const DORMANT_DAYS_PROBLEM = "Enter a whole number of days, from 0 to 365 (0 turns this alert off)";
/** A moderator's last action is kept 400 days, so a longer window could never be met. */
const MAX_DORMANT_DAYS = 365;
/** An approval is remembered for at most this many days. */
const MAX_EDITS_AFTER_APPROVAL_DAYS = 30;
const APPROVAL_DAYS_PROBLEM = "Enter a whole number of days, from 0 to 30 (0 turns this alert off)";

/** Why the text cannot be the bot token, or undefined when it can: blank (no alerts) or a Slack bot token. */
export function botTokenProblem(text: string): string | undefined {
    return text === "" || text.startsWith(BOT_TOKEN_PREFIX) ? undefined : BOT_TOKEN_PROBLEM;
}

/** Why the value cannot be a threshold, or undefined when it can: unset (the default) or a whole number of 0 or more. */
export function wholeNumberProblem(value: number | undefined): string | undefined {
    return value === undefined || (Number.isInteger(value) && value >= 0) ? undefined : WHOLE_NUMBER_PROBLEM;
}

/** Why the value cannot be the dormant moderator window: undefined when it is unset, or 0 to 365 days. */
export function dormantDaysProblem(value: number | undefined): string | undefined {
    return value === undefined || (Number.isInteger(value) && value >= 0 && value <= MAX_DORMANT_DAYS)
        ? undefined
        : DORMANT_DAYS_PROBLEM;
}

/** Why the value cannot be the window for edits after approval: undefined when it is unset, or 0 to 30 days. */
export function approvalDaysProblem(value: number | undefined): string | undefined {
    return value === undefined || (Number.isInteger(value) && value >= 0 && value <= MAX_EDITS_AFTER_APPROVAL_DAYS)
        ? undefined
        : APPROVAL_DAYS_PROBLEM;
}

/** Why the value cannot be a number of days of history: undefined when it is unset, or a whole number of 0 or more. */
export function historyDaysProblem(value: number | undefined): string | undefined {
    return value === undefined || (Number.isInteger(value) && value >= 0) ? undefined : HISTORY_DAYS_PROBLEM;
}

/** Why the value cannot be the channels' retention, or undefined when it can: unset (the default) or 1 to 90 days. */
export function retentionProblem(value: number | undefined): string | undefined {
    return value === undefined || (Number.isInteger(value) && value >= 1 && value <= MAX_SLACK_RETENTION_DAYS)
        ? undefined
        : RETENTION_PROBLEM;
}
