import type { TriggerContext } from "@devvit/public-api";
import type { StatisticsStore } from "../application/ports.js";
import type { ActionTally } from "../domain/counting.js";
import { DIGEST_CLAIM_SECONDS } from "../domain/digest.js";
import type { DayCounts } from "../domain/report.js";

/**
 * The team's statistics in Redis: per UTC day, hashes of counts (`stats:actions:{day}`, `stats:hours:{day}`,
 * `stats:bans:{day}`) and sorted sets (`stats:active:{day}` of moderator hashes, `stats:threads:{day}` of removals by
 * post), each kept 15 days; `stats:counted:{actionId}`, a day's claim that an action was counted; and
 * `stats:digest:{from}`, eight days' claim that a week's digest was sent. Installations already hold these keys.
 */
const KEPT_SECONDS = 1_296_000;
const CLAIM_SECONDS = 86_400;
const MS_PER_SECOND = 1000;
/** At most this many posts are kept a day, those with the most removals. */
const MAX_THREADS = 100;

type StatisticsRedis = Readonly<
    Pick<
        TriggerContext["redis"],
        "set" | "expire" | "hIncrBy" | "hGetAll" | "zAdd" | "zIncrBy" | "zRange" | "zRemRangeByRank"
    >
>;

function keyOf(kind: "actions" | "hours" | "bans" | "active" | "threads", day: string): string {
    return `stats:${kind}:${day}`;
}

/** Adds each count to its field of the hash at `key`, each one atomic increment; nothing for no counts. */
async function addCounts(redis: StatisticsRedis, key: string, counts: Readonly<Record<string, number>>): Promise<void> {
    const fields = Object.entries(counts);
    if (fields.length === 0) {
        return;
    }
    await Promise.all(
        fields.map(async ([field, by]: readonly [string, number]): Promise<void> => {
            await redis.hIncrBy(key, field, by);
        }),
    );
    await redis.expire(key, KEPT_SECONDS);
}

async function addModeratorCounts(redis: StatisticsRedis, tally: ActionTally): Promise<void> {
    if (tally.hour !== undefined) {
        await addCounts(redis, keyOf("hours", tally.day), { [String(tally.hour)]: 1 });
    }
    if (tally.moderatorHash !== undefined) {
        await redis.zAdd(keyOf("active", tally.day), { member: tally.moderatorHash, score: Date.now() });
        await redis.expire(keyOf("active", tally.day), KEPT_SECONDS);
    }
}

async function addRemoval(redis: StatisticsRedis, tally: ActionTally): Promise<void> {
    if (tally.removedFrom === undefined) {
        return;
    }
    const key = keyOf("threads", tally.day);
    await redis.zIncrBy(key, tally.removedFrom, 1);
    await redis.zRemRangeByRank(key, 0, -(MAX_THREADS + 1));
    await redis.expire(key, KEPT_SECONDS);
}

/** A hash's values, as numbers; a value this app did not write is left out. */
function numbers(fields: Readonly<Record<string, string>>): Readonly<Record<string, number>> {
    return Object.fromEntries(
        Object.entries(fields)
            .map(([field, value]: readonly [string, string]): readonly [string, number] => [field, Number(value)])
            .filter(([, value]: readonly [string, number]): boolean => Number.isFinite(value)),
    );
}

async function readDay(redis: StatisticsRedis, day: string): Promise<DayCounts> {
    const [actions, hours, bans, active, threads] = await Promise.all([
        redis.hGetAll(keyOf("actions", day)),
        redis.hGetAll(keyOf("hours", day)),
        redis.hGetAll(keyOf("bans", day)),
        redis.zRange(keyOf("active", day), 0, -1, { by: "rank" }),
        redis.zRange(keyOf("threads", day), 0, -1, { by: "rank" }),
    ]);
    return {
        actions: numbers(actions),
        hours: numbers(hours),
        bans: numbers(bans),
        moderators: active.map(({ member }: Readonly<{ member: string }>): string => member),
        threads: threads.map(
            ({ member, score }: Readonly<{ member: string; score: number }>): { postId: string; removals: number } => ({
                postId: member,
                removals: score,
            }),
        ),
    };
}

export function createRedisStatisticsStore(redis: StatisticsRedis): StatisticsStore {
    return {
        // One atomic SET NX; Redis answers an NX set that finds the key with nil, which Devvit returns as "".
        claimCount: async (actionId: string): Promise<boolean> =>
            (await redis.set(`stats:counted:${actionId}`, "1", {
                nx: true,
                expiration: new Date(Date.now() + CLAIM_SECONDS * MS_PER_SECOND),
            })) !== "",
        addTally: async (tally: ActionTally): Promise<void> => {
            await addCounts(redis, keyOf("actions", tally.day), { [tally.actionField]: 1 });
            await addModeratorCounts(redis, tally);
            await addCounts(redis, keyOf("bans", tally.day), tally.banCounts);
            await addRemoval(redis, tally);
        },
        dayCounts: async (day: string): Promise<DayCounts> => await readDay(redis, day),
        claimDigest: async (from: string): Promise<boolean> =>
            (await redis.set(`stats:digest:${from}`, "1", {
                nx: true,
                expiration: new Date(Date.now() + DIGEST_CLAIM_SECONDS * MS_PER_SECOND),
            })) !== "",
    };
}
