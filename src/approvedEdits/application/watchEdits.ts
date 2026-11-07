import { approvalOf, isEditAfter, isWatching, rememberedDays } from "../domain/approvedEdits.js";
import type { ApprovalAction, ContentUpdate } from "../domain/approvedEdits.js";
import type { ApprovalStore, EditAlerts } from "./ports.js";

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

/** How edits are watched, once the settings are read: the days an approval is watched for, when the edit was, and where alerts go. */
export type EditWatch = Readonly<{ days: number; editAt: number; alerts: EditAlerts }>;

/**
 * Alerts when the author edits a post or comment a moderator approved within the watched days, once a day for an item.
 * An update that leaves the text alone is no edit. Most edits are to items no moderator approved: the approval is read
 * first, and `watch`, which reads the settings, only for an approved item. `watch` gives undefined when alerts cannot
 * be sent. Rejects when the approval cannot be read.
 */
export async function alertOnEdit(
    update: ContentUpdate,
    store: ApprovalStore,
    watch: () => Promise<EditWatch | undefined>,
): Promise<void> {
    if (!update.textChanged || update.itemId === "") {
        return;
    }
    const approval = await store.approvalOf(update.itemId);
    if (approval === undefined) {
        return;
    }
    const watched = await watch();
    if (
        watched !== undefined &&
        isWatching(watched.days) &&
        isEditAfter(approval, watched.editAt, watched.days) &&
        (await claimed(async (): Promise<boolean> => await store.claimAlert(update.itemId)))
    ) {
        await watched.alerts.edited({ update, approval, editAt: watched.editAt });
    }
}
