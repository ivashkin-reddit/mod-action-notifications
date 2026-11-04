import { inChannel } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type { DeletedPostAlert, PostDeletionAlerts } from "../application/ports.js";

const MS_PER_SECOND = 1000;

function deletedPostMessage({ post, subredditName, deletedAt, reason }: DeletedPostAlert): SlackMessage {
    return {
        text: `🗑️ User Deleted High-Score Post: ${String(post.score)} upvotes`,
        username: "Reddit Mod Bot",
        icon_emoji: ":wastebasket:",
        attachments: [
            {
                color: "#cc0000",
                fields: [
                    { title: "📝 Title", value: post.title, short: false },
                    { title: "👤 Author", value: `/u/${post.authorName}`, short: true },
                    { title: "⬆️ Score", value: post.score.toString(), short: true },
                    { title: "🗑️ Reason", value: reason, short: true },
                    { title: "📍 Subreddit", value: `/r/${subredditName}`, short: true },
                    { title: "🔗 Link (may be dead)", value: `https://reddit.com${post.permalink}`, short: false },
                    { title: "⏰ Deleted At", value: deletedAt, short: true },
                ],
                footer: "Reddit Mod Action Bot - Post Deletion Monitor",
                ts: Math.floor(Date.now() / MS_PER_SECOND),
            },
        ],
    };
}

/** Deleted-post alerts as Slack messages, sent to the alert channel when one is set. */
export function createSlackPostDeletionAlerts(send: SlackSender, alertChannel: string): PostDeletionAlerts {
    return {
        highScorePostDeleted: async (alert: DeletedPostAlert): Promise<void> => {
            await send(inChannel(deletedPostMessage(alert), alertChannel));
        },
    };
}
