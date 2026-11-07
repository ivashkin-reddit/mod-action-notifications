import type { TeamReport } from "../domain/report.js";
import type { ResponseReport } from "../domain/responseReport.js";
import type { ResponseBucket } from "../domain/responses.js";

/** A line of the team's report: what Show Team Stats shows as a field, and the digest as one. */
export type ReportLine = Readonly<{ label: string; value: string }>;

/** How an action type is named, e.g. "Post Removed": the moderation module knows; the composition root passes it in. */
export type ActionNamer = (type: string) => string;

/** A count with its noun, e.g. "1 ban", "2 bans". */
export function countOf(count: number, noun: string): string {
    return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

const HOUR_DIGITS = 2;

function hourLabel(hour: number): string {
    return `${String(hour).padStart(HOUR_DIGITS, "0")}:00 UTC`;
}

/** A link to a post by its ID alone, without its title. */
function postLink(postId: string): string {
    return `https://www.reddit.com/comments/${postId.replace(/^t3_/u, "")}/`;
}

function daysLabel(days: number): string {
    return Number.isInteger(days) ? String(days) : days.toFixed(1);
}

function bansLine({ bans }: TeamReport): string {
    const average = bans.averageDays === undefined ? "" : ` (averaging ${daysLabel(bans.averageDays)} days)`;
    return `${countOf(bans.bans, "ban")}: ${String(bans.temporary)} temporary${average}, ${String(bans.permanent)} permanent; ${countOf(bans.unbans, "unban")}`;
}

function hoursLine({ quietHours, hours, busiestHour }: TeamReport): string {
    const busiest = busiestHour === undefined ? "" : `; the busiest hour was ${hourLabel(busiestHour)}`;
    return `${String(quietHours)} of ${String(hours)}${busiest}`;
}

const PERCENT = 100;

const BUCKET_LABELS: Readonly<Record<ResponseBucket, string>> = {
    "15m": "within 15 minutes",
    "1h": "within an hour",
    "4h": "within 4 hours",
    "12h": "within 12 hours",
    "24h": "within a day",
    "longer": "over a day",
};

/** The median's bucket, and how many it is of: "none" without any. */
function medianLine(median: ResponseBucket | undefined, of: string): string {
    return median === undefined ? "none" : `median ${BUCKET_LABELS[median]}, of ${of}`;
}

function percentOf(part: number, whole: number): string {
    return `${String(Math.round((part * PERCENT) / whole))}%`;
}

/** How items ended, as counts and shares: "none" without any. */
function sharesLine({ removed, approved }: Readonly<{ removed: number; approved: number }>): string {
    const whole = removed + approved;
    return whole === 0
        ? "none"
        : `${String(removed)} removed (${percentOf(removed, whole)}), ${String(approved)} approved (${percentOf(approved, whole)})`;
}

/** How the team responded, as lines: to the queue, to modmail, and the removals it reversed. */
function responseLines({ queue, reported, filtered, reversals, modmail }: ResponseReport): readonly ReportLine[] {
    const replies = `${String(modmail.replies)} ${modmail.replies === 1 ? "reply" : "replies"}`;
    return [
        {
            label: "Time to act on the queue",
            value: medianLine(queue.median, `${countOf(queue.handled, "item")} handled`),
        },
        { label: "Reported items", value: sharesLine(reported) },
        { label: "Filtered by AutoModerator", value: sharesLine(filtered) },
        {
            label: "Removals reversed",
            value: `${String(reversals.reddit)} of Reddit's, ${String(reversals.moderator)} of another moderator's`,
        },
        { label: "Modmail replies", value: medianLine(modmail.median, replies) },
    ];
}

/** The report as lines of text. They name action types and link to threads; they name no one. */
export function reportLines(report: TeamReport, nameOf: ActionNamer): readonly ReportLine[] {
    const { actions, topTypes, topThreads } = report;
    return [
        {
            label: "Actions",
            value: `${String(actions.total)}: ${String(actions.moderators)} by moderators, ${String(actions.automoderator)} by AutoModerator, ${String(actions.reddit)} by Reddit`,
        },
        {
            label: "Most common",
            value:
                topTypes.length === 0
                    ? "none"
                    : topTypes.map(({ type, count }): string => `${nameOf(type)} ${String(count)}`).join(", "),
        },
        { label: "Moderators active", value: String(report.activeModerators) },
        { label: "Hours without a moderator action", value: hoursLine(report) },
        { label: "Bans", value: bansLine(report) },
        {
            label: "Most-moderated threads",
            value:
                topThreads.length === 0
                    ? "none"
                    : topThreads
                          .map(
                              ({ postId, removals }): string => `${postLink(postId)} (${countOf(removals, "removal")})`,
                          )
                          .join("\n"),
        },
        ...responseLines(report.responses),
    ];
}
