/**
 * Team statistics: counts of the team's moderation by UTC day, never by moderator, read back as a report for Show
 * Team Stats and the weekly digest.
 *
 * Owns the Redis keys `stats:actions:{day}`, `stats:hours:{day}`, `stats:bans:{day}`, `stats:active:{day}` and
 * `stats:threads:{day}` (15-day TTL), `stats:counted:{actionId}` (1-day TTL) and `stats:digest:{from}` (8-day TTL),
 * and the scheduler job `weeklyStatistics`.
 */
export { countModAction } from "./application/countModAction.js";
export { sendWeeklyDigest, setUpDigest } from "./application/digest.js";
export type { StatisticsStore } from "./application/ports.js";
export { reportFor } from "./application/teamReport.js";
export type { ActorKind, CountedAction } from "./domain/counting.js";
export { DIGEST_JOB_NAME } from "./domain/digest.js";
export { dayRange } from "./domain/report.js";
export { createDevvitDigestScheduler } from "./infrastructure/devvitDigestScheduler.js";
export { createRedisStatisticsStore } from "./infrastructure/redisStatisticsStore.js";
export { countOf, reportLines, type ActionNamer, type ReportLine } from "./infrastructure/reportLines.js";
export { createSlackDigest } from "./infrastructure/slackDigest.js";
