import { conditionTitle } from "./conditions.js";
import type { InForce } from "./conditions.js";
import { dayOf } from "./events.js";
import type { Counts } from "./events.js";

/** The daily summary's scheduler job, and when it runs: 08:00 UTC each day. */
export const SUMMARY_JOB_NAME = "dailySummary";
export const SUMMARY_CRON = "0 8 * * *";

/** A day's summary is claimed for this long, longer than the day after it, when it is sent. */
export const SUMMARY_CLAIM_SECONDS = 172_800;

const DAY_MS = 86_400_000;

/** The UTC day before `now`'s, which a summary sent at `now` covers. */
export function yesterdayOf(now: number): string {
    return dayOf(now - DAY_MS);
}

/** A summary of one UTC day, and the problems in force as it is sent. */
export interface DailySummary {
    readonly day: string;
    readonly lines: readonly Readonly<{ label: string; value: string }>[];
}

function counted(count: number, unit: string): string {
    return `${String(count)} ${unit}${count === 1 ? "" : "s"}`;
}

export function dailySummary(day: string, counts: Counts, problems: readonly InForce[]): DailySummary {
    const failures = counts["monitor-failure"] ?? 0;
    return {
        day,
        lines: [
            { label: "Mod actions", value: String(counts["mod-action"] ?? 0) },
            {
                label: "Alerts",
                value: `${String(counts["alert-delivered"] ?? 0)} delivered, ${String(counts["alert-dropped"] ?? 0)} dropped`,
            },
            {
                label: "Modqueue monitor",
                value: `${counted((counts["monitor-success"] ?? 0) + failures, "run")}, ${String(failures)} failed`,
            },
            {
                label: "Problems now",
                value:
                    problems.length === 0
                        ? "None"
                        : problems.map((problem: InForce): string => conditionTitle(problem.condition)).join("; "),
            },
        ],
    };
}
