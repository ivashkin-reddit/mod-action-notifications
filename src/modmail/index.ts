/**
 * Modmail alerts: a message from a Reddit admin, sent to the alert channel at once, and users waiting for a reply,
 * checked on each run of the monitor job and alerted at most every six hours. Modmail that cannot be read is
 * reported to the health log.
 *
 * Owns the Redis keys `modmail:admin:{messageId}` (1-day TTL) and `modmail:throttle:waiting` (6-hour TTL).
 */
export { alertOnAdminModmail, checkWaitingModmail, type ModmailPorts } from "./application/alertOnModmail.js";
export type { ModmailHealth } from "./application/ports.js";
export { isWaitingAlertOn } from "./domain/modmail.js";
export { messageFromEvent, type ModmailEvent } from "./infrastructure/modmailEvent.js";
export { createRedditModmail, type ModmailReddit } from "./infrastructure/redditModmail.js";
export { createRedisModmailClaims } from "./infrastructure/redisModmailClaims.js";
export { createSlackModmailAlerts } from "./infrastructure/slackModmailAlerts.js";
