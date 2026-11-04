/**
 * Slack: the message format every alert is written in, and delivery to the installation's incoming webhook.
 * Capabilities render their alerts as SlackMessages in their infrastructure and send them through a SlackSender.
 */
export { slackChannel, type SlackAttachment, type SlackField, type SlackMessage, type SlackSender } from './message';
export { createWebhookSender, sendTestMessage } from './webhook';
