import type { TriggerContext } from "@devvit/public-api";
import type { ApprovalStore } from "../application/ports.js";
import type { Approval } from "../domain/approvedEdits.js";

/**
 * `approved_edits:approved:{itemId}`: the item's latest approval, as JSON `{ approver, at }`, for the configured days.
 * `approved_edits:alerted:{itemId}`: a day's claim that an edit to it was alerted.
 */
const DAY_SECONDS = 86_400;
const MS_PER_SECOND = 1000;

type ApprovalRedis = Readonly<Pick<TriggerContext["redis"], "get" | "set">>;

function approvedKey(itemId: string): string {
    return `approved_edits:approved:${itemId}`;
}

function expiringIn(seconds: number): Date {
    return new Date(Date.now() + seconds * MS_PER_SECOND);
}

/** A stored approval; undefined for anything this app did not write. */
function approvalFrom(raw: string | undefined): Approval | undefined {
    try {
        const stored: unknown = JSON.parse(raw ?? "");
        return typeof stored === "object" &&
            stored !== null &&
            "approver" in stored &&
            typeof stored.approver === "string" &&
            "at" in stored &&
            typeof stored.at === "number"
            ? { approver: stored.approver, at: stored.at }
            : undefined;
    } catch {
        // Not JSON: no approval this app remembered.
        return undefined;
    }
}

export function createRedisApprovalStore(redis: ApprovalRedis): ApprovalStore {
    return {
        remember: async (itemId: string, approval: Approval, days: number): Promise<void> => {
            // A later approval replaces an earlier one: the edit is measured from the latest.
            await redis.set(approvedKey(itemId), JSON.stringify({ approver: approval.approver, at: approval.at }), {
                expiration: expiringIn(days * DAY_SECONDS),
            });
        },
        approvalOf: async (itemId: string): Promise<Approval | undefined> =>
            approvalFrom(await redis.get(approvedKey(itemId))),
        claimAlert: async (itemId: string): Promise<boolean> =>
            // One atomic SET NX; Redis answers an NX set that finds the key with nil, which Devvit returns as "".
            (await redis.set(`approved_edits:alerted:${itemId}`, "1", {
                nx: true,
                expiration: expiringIn(DAY_SECONDS),
            })) !== "",
    };
}
