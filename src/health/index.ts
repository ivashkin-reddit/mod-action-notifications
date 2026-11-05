/**
 * Health: the conditions that keep the app from doing its job, such as alerts having nowhere to go, kept in Redis
 * and logged when they start.
 */
export { clearCondition, raiseCondition } from "./application/conditions.js";
export type { ConditionStore } from "./application/ports.js";
export type { Condition } from "./domain/conditions.js";
export { statusLines, type MonitorState, type QueueState, type StatusInput, type StatusLine } from "./domain/status.js";
export { createRedisConditionStore } from "./infrastructure/redisConditionStore.js";
