/**
 * Team statistics: counts of the team's moderation by UTC day, never by moderator, read back as a report for Show
 * Team Stats and the weekly digest.
 *
 * Also how the team responds: how long items wait in the queue and users in modmail, how reported and filtered
 * items end, and the removals moderators reverse.
 *
 * Owns the Redis keys `stats:actions:{day}`, `stats:hours:{day}`, `stats:bans:{day}`, `stats:active:{day}`,
 * `stats:threads:{day}` and `stats:outcomes:{day}` (15-day TTL), `stats:counted:{actionId}` (1-day TTL),
 * `stats:digest:{from}` (8-day TTL), `stats:awaiting` and `stats:modmail_waiting` (a week, pruned),
 * `stats:removed:{day}` (2-day TTL), and the scheduler job `weeklyStatistics`.
 */
export { countModAction } from "./application/countModAction.js";
export { sendWeeklyDigest, setUpDigest } from "./application/digest.js";
export type { StatisticsStore, WaitingStore } from "./application/ports.js";
export {
    countModmailTurn,
    countQueued,
    pruneWaiting,
    type ModmailTurn,
    type QueuedItem,
    type ResponsePorts,
} from "./application/responses.js";
export { reportFor } from "./application/teamReport.js";
export type { ActorKind, CountedAction } from "./domain/counting.js";
export { DIGEST_JOB_NAME } from "./domain/digest.js";
export { dayRange, type TeamReport } from "./domain/report.js";
export { createDevvitDigestScheduler } from "./infrastructure/devvitDigestScheduler.js";
export { createRedisStatisticsStore } from "./infrastructure/redisStatisticsStore.js";
export { createRedisWaitingStore } from "./infrastructure/redisWaitingStore.js";
export { countOf, reportLines, type ActionNamer, type ReportLine } from "./infrastructure/reportLines.js";
export { createSlackDigest } from "./infrastructure/slackDigest.js";
