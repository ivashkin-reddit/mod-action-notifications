import { slackChannel, type SlackSender } from '../../slack';
import type { ModqueueAlerts } from '../application/ports';

const HOUR_MS = 60 * 60 * 1000;

/** Modqueue alerts as Slack messages, sent to the alert channel when one is set. */
export function createSlackModqueueAlerts(send: SlackSender, alertChannel: string): ModqueueAlerts {
  const channel = slackChannel(alertChannel);
  const ts = (): number => Math.floor(Date.now() / 1000);

  return {
    async queueTooLong({ size, posts, comments, threshold }) {
      await send({
        text: `⚠️ Modqueue Alert: ${size} items pending`,
        username: 'Reddit Mod Bot',
        icon_emoji: ':warning:',
        attachments: [
          {
            color: '#ff9900',
            fields: [
              { title: '📋 Queue Size', value: size.toString(), short: true },
              { title: '📝 Posts', value: posts.toString(), short: true },
              { title: '💬 Comments', value: comments.toString(), short: true },
              { title: '🎯 Threshold', value: threshold.toString(), short: true },
            ],
            footer: 'Reddit Mod Action Bot - Modqueue Monitor',
            ts: ts(),
          },
        ],
        channel,
      });
    },

    async waitingTooLong({ oldest, total, ageHours, now }) {
      const itemsList = oldest
        .map((item) => {
          const age = Math.floor((now - item.createdAt.getTime()) / HOUR_MS);
          const type = item.kind === 'post' ? 'Post' : 'Comment';
          return `• ${type} (${age}h old): https://reddit.com${item.permalink}`;
        })
        .join('\n');

      await send({
        text: `⏰ Unmoderated Content Alert: ${total} items over ${ageHours}h old`,
        username: 'Reddit Mod Bot',
        icon_emoji: ':alarm_clock:',
        attachments: [
          {
            color: '#ff6600',
            fields: [{ title: `📌 Oldest Items (showing ${oldest.length} of ${total})`, value: itemsList, short: false }],
            footer: 'Reddit Mod Action Bot - Unmoderated Monitor',
            ts: ts(),
          },
        ],
        channel,
      });
    },

    async monitorFailing({ failures, error }) {
      await send({
        text: `⚠️ Critical: Modqueue Monitoring Failed ${failures} Times`,
        username: 'Reddit Mod Bot',
        icon_emoji: ':warning:',
        attachments: [
          {
            color: '#ff0000',
            fields: [
              { title: '❌ Status', value: 'Scheduler job has failed repeatedly', short: true },
              { title: '🔢 Failure Count', value: failures.toString(), short: true },
              { title: '🔍 Error', value: error || 'Unknown error', short: false },
              { title: '⚙️ Action Required', value: 'Check bot configuration and permissions', short: false },
            ],
            footer: 'Reddit Mod Action Bot - Scheduler Monitor',
            ts: ts(),
          },
        ],
        channel,
      });
    },
  };
}
