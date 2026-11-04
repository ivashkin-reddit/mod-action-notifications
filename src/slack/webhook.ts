import type { SlackMessage, SlackSender } from './message';

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY_MS = 1000;

/** A sender that posts to the webhook URL; it logs and drops every message when the URL is ''. */
export function createWebhookSender(webhookUrl: string): SlackSender {
  return (message) => postToSlack(webhookUrl, message);
}

/** Sends a test message to the webhook's own channel, or logs that no webhook is configured. */
export async function sendTestMessage(webhookUrl: string): Promise<void> {
  if (!webhookUrl) {
    console.error('Cannot test: Slack webhook URL not configured');
    return;
  }

  await postToSlack(webhookUrl, {
    text: '🧪 Test message from Reddit Mod Action Bot',
    username: 'Reddit Mod Bot (Test)',
    icon_emoji: ':robot_face:',
    attachments: [
      {
        color: '#00ff00',
        fields: [
          { title: 'Status', value: 'Bot is working correctly!', short: true },
          { title: 'Timestamp', value: new Date().toISOString(), short: true },
        ],
        footer: 'Reddit Mod Action Bot - Test Message',
      },
    ],
  });
}

/**
 * Posts the message, retrying server errors, rate limiting and network errors up to three times with
 * exponential backoff (1, 2, then 4 seconds). Never rejects: a delivery failure must not break the trigger.
 */
async function postToSlack(webhookUrl: string, message: SlackMessage, retryCount = 0): Promise<void> {
  if (!webhookUrl) {
    console.error('Slack webhook URL not configured');
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const responseText = await response.text();

      if ((response.status >= 500 || response.status === 429) && retryCount < MAX_RETRIES) {
        await backOff(retryCount);
        return postToSlack(webhookUrl, message, retryCount + 1);
      }

      console.error('Slack webhook request failed - verify webhook URL is correct:', {
        status: response.status,
        statusText: response.statusText,
        responseText,
        troubleshooting: 'Check: 1) Webhook URL is valid, 2) Slack workspace permissions, 3) Network connectivity',
      });
    } else {
      await response.text().catch(() => null);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (retryCount < MAX_RETRIES && !errorMessage.includes('deadline exceeded')) {
      await backOff(retryCount);
      return postToSlack(webhookUrl, message, retryCount + 1);
    }

    if (errorMessage.includes('deadline exceeded') || errorMessage.includes('timeout')) {
      console.error('Slack webhook request timed out - Slack may be experiencing delays or webhook URL may be incorrect', {
        channel: message.channel ?? 'default',
        error: errorMessage,
        troubleshooting: 'Verify webhook URL in settings and check Slack status at status.slack.com',
      });
    } else {
      console.error('Error sending Slack message - check webhook URL and network connectivity:', error);
    }
  }
}

function backOff(retryCount: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, BASE_RETRY_DELAY_MS * Math.pow(2, retryCount)));
}
