import { approvalOf, isEditAfter, isWatching, rememberedDays } from "../domain/approvedEdits.js";
import type { ApprovalAction, ContentUpdate } from "../domain/approvedEdits.js";
import type { ApprovalStore, EditAlerts } from "./ports.js";

export interface EditWatchPorts {
    readonly store: ApprovalStore;
    readonly alerts: EditAlerts;
}

/**
 * Remembers a moderator's approval of a post or comment for `days` days, while `days` is above 0. Other actions, and
 * approvals by AutoModerator or Reddit, are not kept. Rejects when storage fails.
 */
export async function rememberApproval(action: ApprovalAction, days: number, store: ApprovalStore): Promise<void> {
    const approved = approvalOf(action);
    if (approved === undefined || !isWatching(days)) {
        return;
    }
    await store.remember(approved.itemId, approved.approval, rememberedDays(days));
}

/** Claims an alert; one that cannot be stored still sends, as a second alert is better than none. */
async function claimed(claim: () => Promise<boolean>): Promise<boolean> {
    return await claim().catch((error: unknown): boolean => {
        console.warn("[approvededits] Could not record that an edit was alerted, so it may be alerted again:", error);
        return true;
    });
}

/**
 * Alerts when the author edits a post or comment a moderator approved within `days`, once a day for an item. An
 * update that leaves the text alone is no edit. Rejects when the approval cannot be read.
 */
export async function alertOnEdit(
    update: ContentUpdate,
    { days, editAt }: Readonly<{ days: number; editAt: number }>,
    ports: EditWatchPorts,
): Promise<void> {
    if (!isWatching(days) || !update.textChanged || update.itemId === "") {
        return;
    }
    const approval = await ports.store.approvalOf(update.itemId);
    if (
        approval !== undefined &&
        isEditAfter(approval, editAt, days) &&
        (await claimed(async (): Promise<boolean> => await ports.store.claimAlert(update.itemId)))
    ) {
        await ports.alerts.edited({ update, approval, editAt });
    }
}
