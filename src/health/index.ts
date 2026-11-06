/**
 * Health: the conditions that keep the app from doing its job, such as alerts having nowhere to go, kept in Redis
 * and logged when they start.
 */
export { clearCondition, raiseCondition, type ConditionPorts } from "./application/conditions.js";
export { noteEvent } from "./application/events.js";
export { sendDailySummary, setUpSummary, type SummaryPorts } from "./application/summary.js";
export { SUMMARY_JOB_NAME, yesterdayOf } from "./domain/summary.js";
export type { ConditionStore } from "./application/ports.js";
export type { Condition } from "./domain/conditions.js";
export { dayOf, type HealthEvent } from "./domain/events.js";
export {
    statusLines,
    type MonitorState,
    type QueueState,
    type SlackStatus,
    type StatusInput,
    type StatusLine,
} from "./domain/status.js";
export { createRedisConditionStore } from "./infrastructure/redisConditionStore.js";
export { createRedisEventStore } from "./infrastructure/redisEventStore.js";
export { createModmailNotices, type NoticeReddit } from "./infrastructure/modmailNotices.js";
export { createDevvitSummaryScheduler } from "./infrastructure/devvitSummaryScheduler.js";
export { createSlackSummary } from "./infrastructure/slackSummary.js";
