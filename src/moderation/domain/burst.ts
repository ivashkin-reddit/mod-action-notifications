import { activityOf } from "./activity.js";
import type { ModeratorRef } from "./activity.js";
import { actionTypeOf, isRedditAccount } from "./modAction.js";
import type { Actor, ModAction } from "./modAction.js";

/**
 * A burst of removals: an account removing at the spike rate, a moderator or one of Reddit's own, whose further
 * removals are counted and summarised rather than alerted one by one.
 */

/** The removals a burst counts: posts and comments, removed or removed as spam. */
export const REMOVAL_TYPES = ["removelink", "removecomment", "spamlink", "spamcomment"] as const;
export type RemovalType = (typeof REMOVAL_TYPES)[number];

/** A minute without a removal ends a burst. */
export const BURST_QUIET_MS = 60_000;
/** While a burst lasts, a progress summary goes every five minutes. */
export const BURST_PROGRESS_MS = 300_000;
/** A summary due this long ago is scheduled again by the next removal: its job was lost. */
export const BURST_OVERDUE_MS = 60_000;
/** A burst with no summary scheduled this long after it opened lost its schedule: the opening removal sets one at once. */
const UNSCHEDULED_OVERDUE_MS = 120_000;

/** A burst's removals by type. */
export type BurstCounts = Readonly<Record<RemovalType, number>>;

export const NO_REMOVALS: BurstCounts = { removelink: 0, removecomment: 0, spamlink: 0, spamcomment: 0 };

/** An open burst. Times are in ms since the epoch, when the app handled each removal. */
export interface Burst {
    /** When the removal that opened it was handled. */
    readonly opened: number;
    /** When the latest removal was handled. */
    readonly last: number;
    /** When its summary next runs; undefined until the removal that opened it has scheduled one. */
    readonly due: number | undefined;
    /** When its last progress summary went; undefined before the first. */
    readonly progressAt: number | undefined;
    /** Its removals by type, the one that opened it included. */
    readonly counts: BurstCounts;
}

/** What a scheduled run does with a burst: close it, or let it go on, with a progress summary when one is due. */
export type BurstStep =
    Readonly<{ kind: "close" }> | Readonly<{ kind: "continue"; progress: boolean; nextDue: number }>;

/** The removals of a burst, as its summary gives them: comments, posts, and how many of them were spam. */
export type BurstTally = Readonly<{ comments: number; posts: number; spam: number }>;

/** A burst's summary: its account, the running totals, its span, and whether it is the last. */
export interface BurstSummary {
    readonly account: ModeratorRef;
    readonly actor: Extract<Actor, "moderator" | "reddit">;
    readonly tally: BurstTally;
    readonly opened: number;
    readonly last: number;
    /** False for a progress summary, while the burst goes on. */
    readonly final: boolean;
}

export function isRemoval(type: string): type is RemovalType {
    return REMOVAL_TYPES.some((removal: RemovalType): boolean => removal === type);
}

/**
 * The account whose burst the action joins: a moderator's or one of Reddit's accounts' removal at the spike rate.
 * None for an unknown moderator's removal, which is a security alert, for any other action, or below the spike.
 */
export function burstAccountOf(modAction: ModAction, actor: Actor): ModeratorRef | undefined {
    if (actor === "unknown-moderator" || !isRemoval(actionTypeOf(modAction)) || modAction.activitySpike === undefined) {
        return undefined;
    }
    return activityOf(modAction);
}

/** How the account's burst is told: as one of Reddit's accounts', or a moderator's. */
export function burstActorOf({ moderatorName }: ModeratorRef): BurstSummary["actor"] {
    return isRedditAccount(moderatorName) ? "reddit" : "moderator";
}

/**
 * What a scheduled run does: close a burst quiet for a minute; otherwise let it go on, with a progress summary five
 * minutes after the burst opened or after the last one, and run next at the earlier of a minute after the latest
 * removal and the next progress summary.
 */
export function burstStep(burst: Pick<Burst, "opened" | "last" | "progressAt">, now: number): BurstStep {
    if (now - burst.last >= BURST_QUIET_MS) {
        return { kind: "close" };
    }
    const since = burst.progressAt ?? burst.opened;
    const progress = now - since >= BURST_PROGRESS_MS;
    const nextProgress = (progress ? now : since) + BURST_PROGRESS_MS;
    return { kind: "continue", progress, nextDue: Math.min(burst.last + BURST_QUIET_MS, nextProgress) };
}

/**
 * Whether the burst's summary is overdue, its job lost: due over a minute ago, or, with none scheduled yet, opened
 * over two minutes ago, when the removal that opened it should long have scheduled one.
 */
export function isOverdue({ due, opened }: Pick<Burst, "due" | "opened">, now: number): boolean {
    return due === undefined ? now - opened > UNSCHEDULED_OVERDUE_MS : now - due > BURST_OVERDUE_MS;
}

export function removedCount(counts: BurstCounts): number {
    return counts.removelink + counts.removecomment + counts.spamlink + counts.spamcomment;
}

/** Whether removals followed the one that opened the burst: else its alert has said everything. */
export function heldAny(counts: BurstCounts): boolean {
    return removedCount(counts) > 1;
}

export function tallyOf(counts: BurstCounts): BurstTally {
    return {
        comments: counts.removecomment + counts.spamcomment,
        posts: counts.removelink + counts.spamlink,
        spam: counts.spamcomment + counts.spamlink,
    };
}
