import { escapeText } from "../../slack/index.js";
import type { SlackMessage } from "../../slack/index.js";
import type { BurstSummary, BurstTally } from "../domain/burst.js";
import type { Actor } from "../domain/modAction.js";
import { actionColor } from "./actionCatalog.js";
import { timestamp, userLink } from "./slackText.js";

const MS_PER_SECOND = 1000;

/**
 * How a burst names its account: a moderator by a link to their profile; one of Reddit's accounts by its name, which
 * no profile has.
 */
export function accountName(name: string, actor: Actor): string {
    return actor === "reddit" ? escapeText(name) : userLink(name);
}

function counted(count: number, noun: string): string {
    return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

/** "140 comments and 3 posts, 12 of them as spam". */
function removedText({ comments, posts, spam }: BurstTally): string {
    const parts = [
        ...(comments > 0 ? [counted(comments, "comment")] : []),
        ...(posts > 0 ? [counted(posts, "post")] : []),
    ].join(" and ");
    return spam > 0 ? `${parts}, ${String(spam)} of them as spam` : parts;
}

/** The subreddit's mod log: filtered to a moderator, and whole for one of Reddit's accounts. */
function modLogLink({ account, actor }: BurstSummary): string {
    const log = `https://old.reddit.com/r/${encodeURIComponent(account.subredditName)}/about/log/`;
    return actor === "reddit" ? log : `${log}?mod=${encodeURIComponent(account.moderatorName)}`;
}

/**
 * A burst's summary as a Slack message for the notification channel: who removed how many comments and posts, when,
 * and a link to the mod log. It quotes no content, so needs no version without quotes.
 */
export function burstMessage(summary: BurstSummary): SlackMessage {
    const { account, actor, tally, opened, last, final } = summary;
    const removed = removedText(tally);
    const when = final
        ? `• *When:* ${timestamp(new Date(opened))} to ${timestamp(new Date(last))}`
        : `• *Since:* ${timestamp(new Date(opened))}`;
    return {
        text: final
            ? `🧹 Removal burst: ${removed} removed`
            : `🧹 Removal burst, still going: ${removed} removed so far`,
        attachments: [
            {
                color: actionColor("removecomment"),
                text: [
                    final ? "🧹 *Removal Burst*" : "🧹 *Removal Burst, Still Going*",
                    `• *${actor === "reddit" ? "Reddit account" : "Moderator"}:* ${accountName(account.moderatorName, actor)}`,
                    `• *Removed:* ${removed}`,
                    when,
                    `• *Mod log:* <${modLogLink(summary)}|Open the mod log>`,
                ].join("\n"),
                mrkdwn_in: ["text"],
                footer: "Mod Action Notifications",
                ts: Math.floor(last / MS_PER_SECOND),
            },
        ],
    };
}
