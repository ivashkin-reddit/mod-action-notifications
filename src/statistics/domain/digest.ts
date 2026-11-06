import type { TeamReport } from "./report.js";

/** The weekly digest's scheduler job; installations already have it scheduled under this name. */
export const DIGEST_JOB_NAME = "weeklyStatistics";
/** Each Monday at 08:00 UTC. */
export const DIGEST_CRON = "0 8 * * 1";
/** A week's digest is claimed for eight days, longer than the job's week. */
export const DIGEST_CLAIM_SECONDS = 691_200;
/** A digest covers the seven UTC days before the day it is sent. */
export const DIGEST_DAYS = 7;

/** The team's figures for a week, Monday to Sunday, and how many actions the week before saw. */
export interface WeeklyDigest {
    /** The week's first and last UTC days, YYYY-MM-DD. */
    readonly from: string;
    readonly to: string;
    readonly report: TeamReport;
    readonly weekBeforeTotal: number;
}
