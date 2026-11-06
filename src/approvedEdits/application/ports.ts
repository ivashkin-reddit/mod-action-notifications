import type { Approval, ContentUpdate } from "../domain/approvedEdits.js";

/** Approvals remembered, and the alerts sent. Each method rejects when storage fails. */
export interface ApprovalStore {
    /** Remembers the item's latest approval for `days` days, replacing any earlier one. */
    readonly remember: (itemId: string, approval: Approval, days: number) => Promise<void>;
    /** The item's remembered approval; undefined when none is, or what is kept cannot be read. */
    readonly approvalOf: (itemId: string) => Promise<Approval | undefined>;
    /** Claims the alert for the item: true the first time in a day. */
    readonly claimAlert: (itemId: string) => Promise<boolean>;
}

/** An edit after approval, sent to the alert channel. Delivery may come later; it does not reject. */
export type EditAlerts = Readonly<{
    edited: (alert: Readonly<{ update: ContentUpdate; approval: Approval; editAt: number }>) => Promise<void>;
}>;
