/** How an item came to wait for a moderator: reported, or held by AutoModerator for review. */
export type QueueSource = "report" | "automoderator";

/** An item waiting for a moderator: since when, in ms since the epoch, and how it came to. */
export interface WaitingEntry {
    readonly at: number;
    readonly source: QueueSource;
}

/** How long a response took, by its bound: within 15 minutes, an hour, 4, 12 or 24 hours, or longer. */
export type ResponseBucket = "15m" | "1h" | "4h" | "12h" | "24h" | "longer";

/** What a mod action does to an item waiting for a moderator. */
export type Settling = "removed" | "approved";

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const QUARTER_HOUR_MINUTES = 15;
const SHORT_HOURS = 4;
const HALF_DAY_HOURS = 12;

/** The buckets in order, each with the longest response it holds; "longer" holds the rest. */
const BOUNDS: readonly (readonly [ResponseBucket, number])[] = [
    ["15m", QUARTER_HOUR_MINUTES * MS_PER_MINUTE],
    ["1h", MS_PER_HOUR],
    ["4h", SHORT_HOURS * MS_PER_HOUR],
    ["12h", HALF_DAY_HOURS * MS_PER_HOUR],
    ["24h", MS_PER_DAY],
];

export const BUCKETS: readonly ResponseBucket[] = [...BOUNDS.map(([bucket]): ResponseBucket => bucket), "longer"];

const REMOVALS: readonly string[] = ["removelink", "removecomment", "spamlink", "spamcomment"];
const APPROVALS: readonly string[] = ["approvelink", "approvecomment"];

/** Waiting items, and conversations, are forgotten after a week. */
export const WAITING_DAYS = 7;
/** At most this many items, and conversations, wait at once; beyond it the oldest are forgotten. */
export const MAX_WAITING = 10_000;
/** What is kept when the waiting list is pruned to make room: enough that it is not pruned again at once. */
export const KEPT_WHEN_FULL = 9000;

/** The bucket a response of `ms` falls in. */
export function bucketOf(ms: number): ResponseBucket {
    return BOUNDS.find(([, bound]: readonly [ResponseBucket, number]): boolean => ms <= bound)?.[0] ?? "longer";
}

/** Whether a mod action removes or approves the item it is on; undefined for any other action. */
export function settlingOf(type: string): Settling | undefined {
    if (REMOVALS.includes(type)) {
        return "removed";
    }
    return APPROVALS.includes(type) ? "approved" : undefined;
}

/** What a moderator settling a waiting item adds to the day's outcomes: how long it waited, and how it ended. */
export function queueOutcome(entry: WaitingEntry, settling: Settling, at: number): Readonly<Record<string, number>> {
    return { [`queue:${bucketOf(at - entry.at)}`]: 1, [`${entry.source}:${settling}`]: 1 };
}

/** What a moderator's reply adds to the day's outcomes: how long the user waited for it. */
export function modmailOutcome(waitingSince: number, at: number): Readonly<Record<string, number>> {
    return { [`modmail:${bucketOf(at - waitingSince)}`]: 1 };
}

/**
 * What a moderator's approval of a removed item adds to the day's outcomes: a reversal of Reddit's removal, or of
 * another moderator's; nothing for their own. `remover` is "reddit" or the remover's hash.
 */
export function reversalOutcome(remover: string, approverHash: string): Readonly<Record<string, number>> {
    if (remover === "reddit") {
        return { "reversed:reddit": 1 };
    }
    return remover === approverHash ? {} : { "reversed:moderator": 1 };
}

/**
 * Which of the waiting entries (ID and since when) to forget at `now`: those waiting over a week, and, while more
 * than MAX_WAITING wait, all but the KEPT_WHEN_FULL newest.
 */
export function staleEntries(entries: readonly (readonly [string, number])[], now: number): readonly string[] {
    const oldest = now - WAITING_DAYS * MS_PER_DAY;
    const current = entries.filter(([, at]: readonly [string, number]): boolean => at >= oldest);
    const crowded =
        current.length > MAX_WAITING
            ? [...current]
                  .sort(
                      (first: readonly [string, number], second: readonly [string, number]): number =>
                          second[1] - first[1],
                  )
                  .slice(KEPT_WHEN_FULL)
            : [];
    return [...entries.filter(([, at]: readonly [string, number]): boolean => at < oldest), ...crowded].map(
        ([id]: readonly [string, number]): string => id,
    );
}
