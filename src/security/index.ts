/**
 * The security watch: alerts on signs of a compromised account or a broken tool. A moderator acting after a long
 * silence, an edit to AutoModerator's config, and AutoModerator removing far more than usual after one.
 *
 * Owns the Redis keys `security:last_action` (400-day TTL), `security:woke:{moderator}`, `security:automod_edit` and
 * `security:misfire:{editAt}`, `security:config_edit:{revisionId}`, `security:last_action_pruned` (1-day TTL), and `security:automod_removals:{hour}` (2-day TTL).
 */
export { watchModAction, type SecurityConfig, type SecurityPorts } from "./application/watchModAction.js";
export type { WatchedAction, WatchedActor } from "./domain/watch.js";
export { createRedditConfigWiki } from "./infrastructure/redditConfigWiki.js";
export { createRedisSecurityStore } from "./infrastructure/redisSecurityStore.js";
export { createSlackSecurityAlerts } from "./infrastructure/slackSecurityAlerts.js";
