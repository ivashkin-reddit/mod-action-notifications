/**
 * Slack: the message format every alert is written in, and delivery to the installation's incoming webhook.
 * Capabilities render their alerts as SlackMessages in their infrastructure and send them through a SlackSender:
 * the outbox for alerts, which paces bursts to what Slack takes, or a direct sender when a moderator waits on the
 * result.
 *
 * Owns the Redis keys `slack_outbox`, `slack_outbox_lease` and `slack_outbox_drain_scheduled`, and the scheduler
 * job OUTBOX_JOB_NAME.
 */
export { escapeText, inChannel, quote, type SlackMessage, type SlackSender } from "./message.js";
export { createSlackOutbox, OUTBOX_JOB_NAME, type SlackOutbox } from "./outbox.js";
export { createWebhookSender, sendTestMessage } from "./webhook.js";
