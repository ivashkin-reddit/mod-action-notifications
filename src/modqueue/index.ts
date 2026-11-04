/**
 * Modqueue monitoring: a scheduler job that alerts moderators when the modqueue grows too long or items wait
 * too long, and when the monitor itself keeps failing.
 *
 * Owns the Redis keys `modqueue_monitor_job_id`, `mod_actions:throttle:{modqueue_size|modqueue_unmoderated}`
 * (1-hour TTL) and `scheduler_failure_count` (1-hour TTL), and the scheduler job MONITOR_JOB_NAME.
 */
export { isMonitoringEnabled, type MonitorThresholds } from './domain/monitoring';
export { checkModqueue, type ModqueueConfig } from './application/checkModqueue';
export { monitorJobStatus, setupMonitoring, type MonitorJobStatus } from './application/monitorJob';
export { createDevvitMonitorScheduler, MONITOR_JOB_NAME } from './infrastructure/devvitScheduler';
export { openRedditModqueue } from './infrastructure/redditModqueue';
export { createRedisMonitorStore } from './infrastructure/redisMonitorStore';
export { createSlackModqueueAlerts } from './infrastructure/slackAlerts';
