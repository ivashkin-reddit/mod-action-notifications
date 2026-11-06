/**
 * Edits after approval: a moderator's approval of a post or comment is remembered for the configured days, and an
 * edit by its author within them is sent to the alert channel, once a day for an item, without either text.
 *
 * Owns the Redis keys `approved_edits:approved:{itemId}` (the configured days, at most 30) and
 * `approved_edits:alerted:{itemId}` (1-day TTL).
 */
export { alertOnEdit, rememberApproval, type EditWatch } from "./application/watchEdits.js";
export type { ApprovalAction, Approver, ContentUpdate } from "./domain/approvedEdits.js";
export { createRedisApprovalStore } from "./infrastructure/redisApprovalStore.js";
export { createSlackEditAlerts } from "./infrastructure/slackEditAlerts.js";
export {
    updateFromCommentEvent,
    updateFromPostEvent,
    type CommentUpdateEvent,
    type PostUpdateEvent,
} from "./infrastructure/updateEvents.js";
