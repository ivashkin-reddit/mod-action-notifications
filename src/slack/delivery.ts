/**
 * Slack delivery, for the composition root alone: the outbox every alert goes through, which paces bursts to what
 * Slack takes, and direct sending, for a moderator waiting on the result. Capability adapters get a SlackSender
 * and never choose how it delivers.
 *
 * Owns the Redis keys `slack_outbox`, `slack_outbox_lease` and `slack_outbox_drain_scheduled`, and the scheduler
 * job OUTBOX_JOB_NAME.
 */
export { createSlackOutbox, OUTBOX_JOB_NAME, type SlackOutbox } from "./outbox.js";
export { createWebhookSender, sendTestMessage } from "./webhook.js";
