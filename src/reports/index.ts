/**
 * Report alerts: a report with one of the urgent reasons moderators configure, and reports piling up on a post or
 * comment, each sent to the alert channel once a day for an item.
 *
 * Owns the Redis keys `reports:urgent:{itemId}` and `reports:pileup:{itemId}` (1-day TTL).
 */
export { alertOnReport, type ReportsConfig } from "./application/alertOnReport.js";
export type { ContentReport } from "./domain/reports.js";
export {
    reportFromCommentEvent,
    reportFromPostEvent,
    type CommentReportEvent,
    type PostReportEvent,
} from "./infrastructure/reportEvents.js";
export { createRedisReportClaims } from "./infrastructure/redisReportClaims.js";
export { createSlackReportAlerts } from "./infrastructure/slackReportAlerts.js";
