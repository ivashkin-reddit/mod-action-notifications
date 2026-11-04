import { slackChannel, type SlackMessage, type SlackSender } from '../../slack';
import type { PostDeletionAlerts } from '../application/ports';

/** Deleted-post alerts as Slack messages, sent to the alert channel when one is set. */
export function createSlackPostDeletionAlerts(send: SlackSender, alertChannel: string): PostDeletionAlerts {
  return {
    async highScorePostDeleted({ post, subredditName, deletedAt, reason }) {
      const message: SlackMessage = {
        text: `🗑️ User Deleted High-Score Post: ${post.score} upvotes`,
        username: 'Reddit Mod Bot',
        icon_emoji: ':wastebasket:',
        attachments: [
          {
            color: '#cc0000',
            fields: [
              { title: '📝 Title', value: post.title, short: false },
              { title: '👤 Author', value: `/u/${post.authorName}`, short: true },
              { title: '⬆️ Score', value: post.score.toString(), short: true },
              { title: '🗑️ Reason', value: reason, short: true },
              { title: '📍 Subreddit', value: `/r/${subredditName}`, short: true },
              { title: '🔗 Link (may be dead)', value: `https://reddit.com${post.permalink}`, short: false },
              { title: '⏰ Deleted At', value: deletedAt, short: true },
            ],
            footer: 'Reddit Mod Action Bot - Post Deletion Monitor',
            ts: Math.floor(Date.now() / 1000),
          },
        ],
        channel: slackChannel(alertChannel),
      };
      await send(message);
    },
  };
}
