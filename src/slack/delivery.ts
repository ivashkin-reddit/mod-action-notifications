/**
 * Slack delivery, for the composition root alone: the outbox every alert goes through, which paces bursts to what
 * Slack takes and keeps no text from content deleted on Reddit, and direct sending, for a moderator waiting on the
 * result. Capability adapters get a SlackSender and never choose how it delivers.
 *
 * Owns the Redis keys that start `slack_outbox`, and the scheduler job OUTBOX_JOB_NAME.
 */
export type { DeliveryCondition, DeliveryConditions } from "./conditions.js";
export { createSlackOutbox, forgetContent, type SlackOutbox } from "./outbox.js";
export { OUTBOX_JOB_NAME } from "./schedule.js";
export { createWebhookSender, sendTestMessage } from "./webhook.js";
