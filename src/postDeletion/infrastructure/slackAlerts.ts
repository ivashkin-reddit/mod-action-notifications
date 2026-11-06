import { inChannel, withoutTitle } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type { DeletedPostAlert, PostDeletionAlerts } from "../application/ports.js";

const MS_PER_SECOND = 1000;

/**
 * The alert names the post by its link alone, without its title or author: Devvit's rules ask apps to delete a
 * deleted post's content from external services, and Reddit itself no longer shows who posted it.
 */
function deletedPostMessage({ post, subredditName, deletedAt, reason }: DeletedPostAlert): SlackMessage {
    return {
        text: `🗑️ User Deleted High-Score Post: ${String(post.score)} upvotes`,
        username: "Mod Action Notifications",
        icon_emoji: ":wastebasket:",
        attachments: [
            {
                color: "#cc0000",
                fields: [
                    { title: "⬆️ Score", value: post.score.toString(), short: true },
                    { title: "🗑️ Reason", value: reason, short: true },
                    { title: "📍 Subreddit", value: `/r/${subredditName}`, short: true },
                    { title: "🔗 Link", value: `https://reddit.com${withoutTitle(post.permalink)}`, short: false },
                    { title: "⏰ Deleted At", value: deletedAt, short: true },
                ],
                footer: "Mod Action Notifications - Post Deletion Monitor",
                ts: Math.floor(Date.now() / MS_PER_SECOND),
            },
        ],
    };
}

/** Deleted-post alerts as Slack messages, sent to the alert channel. */
export function createSlackPostDeletionAlerts(send: SlackSender, alertChannel: string): PostDeletionAlerts {
    return {
        highScorePostDeleted: async (alert: DeletedPostAlert): Promise<void> => {
            await send(inChannel(deletedPostMessage(alert), alertChannel));
        },
    };
}
