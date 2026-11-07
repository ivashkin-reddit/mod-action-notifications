import { escapeText } from "../../slack/index.js";
import { isRedditAccount } from "../domain/modAction.js";

/** How mod-action alerts write names and times in Slack. */

/** A Slack link to the user's profile, without any u/ prefix; "Unknown" for a blank name. */
export function userLink(username: string | undefined): string {
    const trimmed = username?.trim() ?? "";
    if (trimmed === "") {
        return "Unknown";
    }
    const normalized = trimmed.replace(/^u\//iu, "");
    return `<https://www.reddit.com/u/${encodeURIComponent(normalized)}|u/${escapeText(normalized)}>`;
}

/**
 * Who took an action, as alerts name them: one of Reddit's accounts in plain text, as it stands for Reddit, not a
 * person, and Anti-Evil Operations has no profile to link to; anyone else by a link to their profile.
 */
export function actorName(name: string | undefined): string {
    return isRedditAccount(name) ? escapeText(name ?? "") : userLink(name);
}

/** What alerts call who took an action: a Reddit account, or a moderator. */
export function actorTitle(name: string | undefined): string {
    return isRedditAccount(name) ? "Reddit account" : "Moderator";
}

/** A time as alerts show it: in UTC, to the second. */
export function timestamp(date: Date): string {
    return date.toISOString().replace("T", " ").replace(/\..+/u, " UTC");
}
