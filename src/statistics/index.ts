/**
 * Team statistics: counts of the team's moderation by UTC day, never by moderator, read back as a report for Show
 * Team Stats and the weekly digest.
 *
 * Owns the Redis keys `stats:actions:{day}`, `stats:hours:{day}`, `stats:bans:{day}`, `stats:active:{day}` and
 * `stats:threads:{day}` (15-day TTL), and `stats:counted:{actionId}` (1-day TTL).
 */
export { countModAction } from "./application/countModAction.js";
export type { StatisticsStore } from "./application/ports.js";
export type { ActorKind, CountedAction } from "./domain/counting.js";
export { createRedisStatisticsStore } from "./infrastructure/redisStatisticsStore.js";
