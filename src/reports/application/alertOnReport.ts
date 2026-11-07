import { isPileUp, matchedReason } from "../domain/reports.js";
import type { ContentReport } from "../domain/reports.js";
import type { ReportAlerts, ReportClaims } from "./ports.js";

export interface ReportsConfig {
    /** Reasons that alert at once, as configured. */
    readonly urgentReasons: readonly string[];
    /** A post or comment reaching this many reports alerts once; 0 turns it off. */
    readonly pileUpThreshold: number;
}

export interface ReportsPorts {
    readonly claims: ReportClaims;
    readonly alerts: ReportAlerts;
}

/** Claims an alert; one that cannot be stored still sends, as a second alert is better than none. */
async function claimed(claim: () => Promise<boolean>): Promise<boolean> {
    return await claim().catch((error: unknown): boolean => {
        console.warn("[reports] Could not record that a report was alerted, so it may be alerted again:", error);
        return true;
    });
}

/**
 * Alerts on a report: at once when its reason is one of the urgent reasons, and once when the item's reports reach
 * the pile-up threshold, unless moderators ignore its reports. Each alert goes once a day for an item.
 */
export async function alertOnReport(report: ContentReport, config: ReportsConfig, ports: ReportsPorts): Promise<void> {
    if (report.itemId === "") {
        return;
    }
    const reason = matchedReason(report.reason, config.urgentReasons);
    if (
        reason !== undefined &&
        (await claimed(async (): Promise<boolean> => await ports.claims.claimUrgent(report.itemId)))
    ) {
        await ports.alerts.urgent({ reason, report });
    }
    if (
        !report.ignoreReports &&
        isPileUp(report.reportCount, config.pileUpThreshold) &&
        (await claimed(async (): Promise<boolean> => await ports.claims.claimPileUp(report.itemId)))
    ) {
        await ports.alerts.pileUp(report);
    }
}
