import type { TriggerContext } from "@devvit/public-api";
import type { ConditionStore } from "../application/ports.js";
import type { Condition } from "../domain/conditions.js";

/**
 * The conditions in force: a hash of when each started, by condition. Kept for a week from when the app last met
 * one, so a condition nothing meets any more is forgotten.
 */
const CONDITIONS_KEY = "health:conditions";
/** A week. */
const CONDITIONS_MEMORY_SECONDS = 604_800;
const MS_PER_SECOND = 1000;

/** Present while a condition's reminder is claimed. */
function reminderKey(condition: Condition): string {
    return `health:reminder:${condition}`;
}

type ConditionRedis = Readonly<Pick<TriggerContext["redis"], "hSetNX" | "hGet" | "hDel" | "set" | "expire">>;

export function createRedisConditionStore(redis: ConditionRedis): ConditionStore {
    return {
        start: async (condition: Condition, since: number): Promise<boolean> => {
            const started = (await redis.hSetNX(CONDITIONS_KEY, condition, String(since))) === 1;
            await redis.expire(CONDITIONS_KEY, CONDITIONS_MEMORY_SECONDS);
            return started;
        },
        since: async (condition: Condition): Promise<number | undefined> => {
            const since = await redis.hGet(CONDITIONS_KEY, condition);
            return since === undefined ? undefined : Number(since);
        },
        claimReminder: async (condition: Condition, seconds: number): Promise<boolean> =>
            (await redis.set(reminderKey(condition), "1", {
                nx: true,
                expiration: new Date(Date.now() + seconds * MS_PER_SECOND),
            })) !== "",
        end: async (condition: Condition): Promise<boolean> => (await redis.hDel(CONDITIONS_KEY, [condition])) === 1,
    };
}
