import type { TeamReport } from "../domain/report.js";

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
    ];
}
