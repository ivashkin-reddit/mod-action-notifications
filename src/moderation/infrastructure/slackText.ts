import { escapeText } from "../../slack/index.js";

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

/** A time as alerts show it: in UTC, to the second. */
export function timestamp(date: Date): string {
    return date.toISOString().replace("T", " ").replace(/\..+/u, " UTC");
}
