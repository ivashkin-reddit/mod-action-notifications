import type { TriggerContext } from "@devvit/public-api";
import type { WaitingStore } from "../application/ports.js";
import { MAX_WAITING, staleEntries, WAITING_DAYS } from "../domain/responses.js";
import type { WaitingEntry } from "../domain/responses.js";

/**
 * What waits for a moderator, in Redis: `stats:awaiting` (item ID to "{at}:{source}") and `stats:modmail_waiting`
 * (conversation ID to "{at}"), each expiring a day after the last item could still be counted, and pruned to a week
 * and MAX_WAITING; and `stats:removed:{day}` (item ID to "reddit" or the remover's hash), kept two days.
 */
const AWAITING = "stats:awaiting";
const MODMAIL_WAITING = "stats:modmail_waiting";
const DAY_SECONDS = 86_400;
const LIST_SECONDS = (WAITING_DAYS + 1) * DAY_SECONDS;
/** A removal is remembered for today and tomorrow: an approval looks for it on its own day and the day before. */
const REMOVED_DAYS = 2;
const REMOVED_SECONDS = REMOVED_DAYS * DAY_SECONDS;

type WaitingRedis = Readonly<
    Pick<TriggerContext["redis"], "hSetNX" | "hGet" | "hGetAll" | "hDel" | "hLen" | "hSet" | "expire">
>;

function removedKey(day: string): string {
    return `stats:removed:${day}`;
}

/** A stored entry; undefined for anything this app did not write. */
function entryFrom(raw: string): WaitingEntry | undefined {
    const [at, source] = raw.split(":");
    const ms = Number(at);
    return Number.isFinite(ms) && (source === "report" || source === "automoderator") ? { at: ms, source } : undefined;
}

/** Since when an entry of either list waits; 0, so it is forgotten, for anything this app did not write. */
function sinceOf(raw: string): number {
    const ms = Number(raw.split(":")[0]);
    return Number.isFinite(ms) ? ms : 0;
}

/** Forgets the list's entries that waited over a week, and the oldest beyond MAX_WAITING. */
async function prune(redis: WaitingRedis, key: string, now: number): Promise<void> {
    const entries = Object.entries(await redis.hGetAll(key)).map(
        ([id, raw]: readonly [string, string]): readonly [string, number] => [id, sinceOf(raw)],
    );
    const stale = staleEntries(entries, now);
    if (stale.length > 0) {
        await redis.hDel(key, [...stale]);
    }
}

/** Adds the field unless it is there: one atomic HSETNX, so the first entry wins. Prunes a list grown too long. */
async function markOnce(
    redis: WaitingRedis,
    { key, field, value, at }: Readonly<{ key: string; field: string; value: string; at: number }>,
): Promise<void> {
    const added = await redis.hSetNX(key, field, value);
    await redis.expire(key, LIST_SECONDS);
    if (added === 1 && (await redis.hLen(key)) > MAX_WAITING) {
        await prune(redis, key, at);
    }
}

/**
 * Takes the field: its value for the one call whose HDEL removed it, undefined for any other, so concurrent
 * handlers count it once.
 */
async function take(redis: WaitingRedis, key: string, field: string): Promise<string | undefined> {
    const raw = await redis.hGet(key, field);
    if (raw === undefined) {
        return undefined;
    }
    return (await redis.hDel(key, [field])) === 1 ? raw : undefined;
}

export function createRedisWaitingStore(redis: WaitingRedis): WaitingStore {
    return {
        markAwaiting: async (itemId: string, entry: WaitingEntry): Promise<void> => {
            await markOnce(redis, {
                key: AWAITING,
                field: itemId,
                value: `${String(entry.at)}:${entry.source}`,
                at: entry.at,
            });
        },
        takeAwaiting: async (itemId: string): Promise<WaitingEntry | undefined> => {
            const raw = await take(redis, AWAITING, itemId);
            return raw === undefined ? undefined : entryFrom(raw);
        },
        noteRemoval: async (day: string, itemId: string, remover: string): Promise<void> => {
            await redis.hSet(removedKey(day), { [itemId]: remover });
            await redis.expire(removedKey(day), REMOVED_SECONDS);
        },
        takeRemoval: async (days: readonly string[], itemId: string): Promise<string | undefined> => {
            const taken = await Promise.all(
                days.map(
                    async (day: string): Promise<string | undefined> => await take(redis, removedKey(day), itemId),
                ),
            );
            return taken.find((remover: string | undefined): boolean => remover !== undefined);
        },
        markModmailWaiting: async (conversationId: string, at: number): Promise<void> => {
            await markOnce(redis, { key: MODMAIL_WAITING, field: conversationId, value: String(at), at });
        },
        takeModmailWaiting: async (conversationId: string): Promise<number | undefined> => {
            const raw = await take(redis, MODMAIL_WAITING, conversationId);
            return raw === undefined ? undefined : sinceOf(raw);
        },
        prune: async (now: number): Promise<void> => {
            await prune(redis, AWAITING, now);
            await prune(redis, MODMAIL_WAITING, now);
        },
    };
}
