import type { TriggerContext } from "@devvit/public-api";
import type { SecurityStore } from "../application/ports.js";
import { minuteOf } from "../domain/watch.js";
import type { ConfigEdit } from "../domain/watch.js";

/**
 * The security watch in Redis. Installations already hold these keys:
 * - `security:last_action`, a hash of lower-cased moderator to when they last acted, for 400 days from the last;
 * - `security:woke:{moderator}`, a day's claim that their waking was alerted;
 * - `security:automod_removals:{hour}`, AutoModerator's removals by minute of an hour since the epoch, for 2 days;
 * - `security:automod_edit`, the last edit to AutoModerator's config, for a day;
 * - `security:misfire:{editAt}`, a day's claim that a misfire after that edit was alerted.
 */
const LAST_ACTION_KEY = "security:last_action";
const LAST_ACTION_SECONDS = 34_560_000;
const REMOVALS_SECONDS = 172_800;
const EDIT_KEY = "security:automod_edit";
const DAY_SECONDS = 86_400;
const MS_PER_SECOND = 1000;
const MINUTES_PER_HOUR = 60;

type SecurityRedis = Readonly<
    Pick<TriggerContext["redis"], "get" | "set" | "expire" | "hGet" | "hSet" | "hDel" | "hIncrBy" | "hGetAll">
>;

/** One atomic SET NX for a day; Redis answers an NX set that finds the key with nil, which Devvit returns as "". */
async function claim(redis: SecurityRedis, key: string): Promise<boolean> {
    return (
        (await redis.set(key, "1", { nx: true, expiration: new Date(Date.now() + DAY_SECONDS * MS_PER_SECOND) })) !== ""
    );
}

function removalsKey(hour: number): string {
    return `security:automod_removals:${String(hour)}`;
}

/** A stored edit; undefined for anything this app did not write. */
function editOf(raw: string | undefined): ConfigEdit | undefined {
    try {
        const stored: unknown = JSON.parse(raw ?? "");
        return typeof stored === "object" &&
            stored !== null &&
            "at" in stored &&
            typeof stored.at === "number" &&
            "by" in stored &&
            typeof stored.by === "string"
            ? { at: stored.at, by: stored.by }
            : undefined;
    } catch {
        // Not JSON: no edit this app noted.
        return undefined;
    }
}

async function removalsBetween(
    redis: SecurityRedis,
    from: number,
    to: number,
): Promise<readonly (readonly [number, number])[]> {
    const hours = Array.from(
        { length: Math.floor(to / MINUTES_PER_HOUR) - Math.floor(from / MINUTES_PER_HOUR) + 1 },
        (_unused: unknown, index: number): number => Math.floor(from / MINUTES_PER_HOUR) + index,
    );
    const byHour = await Promise.all(
        hours.map(async (hour: number): Promise<readonly (readonly [number, number])[]> =>
            Object.entries(await redis.hGetAll(removalsKey(hour))).map(
                ([minute, count]: readonly [string, string]): readonly [number, number] => [
                    hour * MINUTES_PER_HOUR + Number(minute),
                    Number(count),
                ],
            ),
        ),
    );
    return byHour.flat().filter(([, count]: readonly [number, number]): boolean => Number.isFinite(count));
}

export function createRedisSecurityStore(redis: SecurityRedis): SecurityStore {
    return {
        lastAction: async (moderator: string): Promise<number | undefined> => {
            const at = Number(await redis.hGet(LAST_ACTION_KEY, moderator));
            return Number.isFinite(at) && at > 0 ? at : undefined;
        },
        noteAction: async (moderator: string, at: number): Promise<void> => {
            await redis.hSet(LAST_ACTION_KEY, { [moderator]: String(at) });
            await redis.expire(LAST_ACTION_KEY, LAST_ACTION_SECONDS);
        },
        forgetModerator: async (moderator: string): Promise<void> => {
            await redis.hDel(LAST_ACTION_KEY, [moderator]);
        },
        claimWake: async (moderator: string): Promise<boolean> => await claim(redis, `security:woke:${moderator}`),
        countAutoModRemoval: async (at: number): Promise<void> => {
            const minute = minuteOf(at);
            const key = removalsKey(Math.floor(minute / MINUTES_PER_HOUR));
            await redis.hIncrBy(key, String(minute % MINUTES_PER_HOUR), 1);
            await redis.expire(key, REMOVALS_SECONDS);
        },
        autoModRemovals: async (from: number, to: number): Promise<readonly (readonly [number, number])[]> =>
            await removalsBetween(redis, from, to),
        noteConfigEdit: async (edit: ConfigEdit): Promise<void> => {
            await redis.set(EDIT_KEY, JSON.stringify({ at: edit.at, by: edit.by }), {
                expiration: new Date(Date.now() + DAY_SECONDS * MS_PER_SECOND),
            });
        },
        lastConfigEdit: async (): Promise<ConfigEdit | undefined> => editOf(await redis.get(EDIT_KEY)),
        claimMisfire: async (editAt: number): Promise<boolean> =>
            await claim(redis, `security:misfire:${String(editAt)}`),
    };
}
