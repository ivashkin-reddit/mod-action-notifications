/**
 * Modqueue monitoring: a scheduler job that alerts moderators when the modqueue grows too long, when content waits
 * unreviewed too long, when reported content is too old, and when the monitor itself keeps failing.
 *
 * Owns the Redis keys `modqueue_monitor_job_id`,
 * `mod_actions:throttle:{modqueue_size|modqueue_unmoderated|modqueue_reported}` (1-hour TTL) and
 * `scheduler_failure_count` (1-hour TTL), and the scheduler job MONITOR_JOB_NAME.
 */
export { isMonitoringEnabled, type MonitorThresholds } from "./domain/monitoring.js";
export { checkModqueue, type ModqueueConfig } from "./application/checkModqueue.js";
export {
    monitorJobStatus,
    setupMonitoring,
    type MonitorJobStatus,
    type MonitoringSetup,
} from "./application/monitorJob.js";
export { createDevvitMonitorScheduler, MONITOR_JOB_NAME } from "./infrastructure/devvitScheduler.js";
export { openRedditQueues } from "./infrastructure/redditModqueue.js";
export { createRedisMonitorStore } from "./infrastructure/redisMonitorStore.js";
export { createSlackModqueueAlerts } from "./infrastructure/slackAlerts.js";
