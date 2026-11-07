import type { ContentReport } from "../domain/reports.js";

/** Which reported items were alerted. Each method rejects when storage fails. */
export interface ReportClaims {
    /** Claims the urgent alert for the item: true the first time in a day. Safe for reports handled at once. */
    readonly claimUrgent: (itemId: string) => Promise<boolean>;
    /** Claims the pile-up alert for the item: true the first time in a day. */
    readonly claimPileUp: (itemId: string) => Promise<boolean>;
}

/** Report alerts, sent to the alert channel. Delivery may come later; neither rejects. */
export interface ReportAlerts {
    /** A report with an urgent reason: `reason` is the configured reason it matched. */
    readonly urgent: (alert: Readonly<{ reason: string; report: ContentReport }>) => Promise<void>;
    readonly pileUp: (report: ContentReport) => Promise<void>;
}
