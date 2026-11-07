/** A moderator's approval of a post or comment: who approved it, and when, in ms since the epoch. */
export interface Approval {
    readonly approver: string;
    readonly at: number;
}

/** Who took a mod action, as this capability tells them apart: only a moderator's approval is remembered. */
export type Approver = "moderator" | "automoderator" | "reddit";

/** A mod action, as this capability reads it. */
export interface ApprovalAction {
    readonly type: string;
    readonly actor: Approver;
    readonly moderatorName: string | undefined;
    /** The post or comment acted on: a comment's ID for a comment, else the post's. */
    readonly itemId: string | undefined;
    readonly occurredAt: Date;
}

/** An update to a post or comment, as its trigger tells of it. */
export interface ContentUpdate {
    readonly itemId: string;
    readonly kind: "post" | "comment";
    /** Its author, who alone can edit it. */
    readonly author: string;
    readonly permalink: string;
    /** Whether its text changed: Reddit also sends an update that leaves the text alone. */
    readonly textChanged: boolean;
}

const APPROVALS: readonly string[] = ["approvelink", "approvecomment"];
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** An approval is remembered for at most this many days, whatever the setting says. */
export const MAX_APPROVAL_DAYS = 30;

/** Whether edits after approval are watched: 0 days turns it off. */
export function isWatching(days: number): boolean {
    return days > 0;
}

/** How many days an approval is remembered: the setting, at most MAX_APPROVAL_DAYS. */
export function rememberedDays(days: number): number {
    return Math.min(days, MAX_APPROVAL_DAYS);
}

/** The item a moderator approved, and the approval; undefined for any other action, or one AutoModerator or Reddit took. */
export function approvalOf(action: ApprovalAction): Readonly<{ itemId: string; approval: Approval }> | undefined {
    const { type, actor, moderatorName, itemId, occurredAt } = action;
    if (!APPROVALS.includes(type) || actor !== "moderator" || moderatorName === undefined || moderatorName === "") {
        return undefined;
    }
    return itemId === undefined || itemId === ""
        ? undefined
        : { itemId, approval: { approver: moderatorName, at: occurredAt.getTime() } };
}

/** Whether an edit at `editAt` came after the approval, within `days` of it. */
export function isEditAfter(approval: Approval, editAt: number, days: number): boolean {
    return editAt >= approval.at && editAt - approval.at <= rememberedDays(days) * MS_PER_DAY;
}

/** How many whole hours passed from the approval to the edit. */
export function hoursBetween(approval: Approval, editAt: number): number {
    return Math.floor((editAt - approval.at) / MS_PER_HOUR);
}
