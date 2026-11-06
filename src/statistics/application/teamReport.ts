import { dayOf } from "../domain/counting.js";
import { teamReport } from "../domain/report.js";
import type { ReportDay, TeamReport } from "../domain/report.js";
import type { StatisticsStore } from "./ports.js";

const HOURS_IN_DAY = 24;

/**
 * The team's report for these UTC days. Today's covers its hours up to and including the current one, so an action
 * this hour is not counted in a quiet hour. Rejects when storage fails.
 */
export async function reportFor(store: StatisticsStore, days: readonly string[], now: number): Promise<TeamReport> {
    const today = dayOf(new Date(now));
    const reportDays = await Promise.all(
        days.map(async (day: string): Promise<ReportDay> => ({
            counts: await store.dayCounts(day),
            hours: day === today ? new Date(now).getUTCHours() + 1 : HOURS_IN_DAY,
        })),
    );
    return teamReport(reportDays);
}
