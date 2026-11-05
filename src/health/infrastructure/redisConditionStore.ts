import type { TriggerContext } from "@devvit/public-api";
import type { ConditionStore } from "../application/ports.js";
import { isCondition } from "../domain/conditions.js";
import type { Condition, InForce } from "../domain/conditions.js";

/**
 * The conditions in force: a hash of when each started and what the app saw then, by condition, as JSON. Kept for a week from when the app last met
 * one, so a condition nothing meets any more is forgotten.
 */
const CONDITIONS_KEY = "health:conditions";
/** A week. */
const CONDITIONS_MEMORY_SECONDS = 604_800;
const MS_PER_SECOND = 1000;

/** Which conditions moderators were sent a notice of: a hash of when, by condition. */
const NOTICED_KEY = "health:noticed";

/** Present while a condition's modmail notice is claimed. */
function noticeKey(condition: Condition): string {
    return `health:notice:${condition}`;
}

/** Present while a condition's reminder is claimed. */
function reminderKey(condition: Condition): string {
    return `health:reminder:${condition}`;
}

type ConditionRedis = Readonly<
    Pick<TriggerContext["redis"], "hSetNX" | "hSet" | "hGet" | "hGetAll" | "hDel" | "set" | "expire">
>;

/** What the hash holds for a condition; undefined for a value this version cannot read. */
function recordOf(json: string): Readonly<{ since: number; detail: string }> | undefined {
    try {
        const parsed: unknown = JSON.parse(json);
        return typeof parsed === "object" &&
            parsed !== null &&
            "since" in parsed &&
            typeof parsed.since === "number" &&
            "detail" in parsed &&
            typeof parsed.detail === "string"
            ? { since: parsed.since, detail: parsed.detail }
            : undefined;
    } catch {
        // Not JSON: not a value this version wrote.
        return undefined;
    }
}

export function createRedisConditionStore(redis: ConditionRedis): ConditionStore {
    return {
        start: async (condition: Condition, since: number, detail: string): Promise<boolean> => {
            const started = (await redis.hSetNX(CONDITIONS_KEY, condition, JSON.stringify({ since, detail }))) === 1;
            await redis.expire(CONDITIONS_KEY, CONDITIONS_MEMORY_SECONDS);
            return started;
        },
        since: async (condition: Condition): Promise<number | undefined> => {
            const record = await redis.hGet(CONDITIONS_KEY, condition);
            return record === undefined ? undefined : recordOf(record)?.since;
        },
        inForce: async (): Promise<readonly InForce[]> =>
            Object.entries(await redis.hGetAll(CONDITIONS_KEY)).flatMap(
                ([condition, json]: readonly [string, string]): InForce[] => {
                    const record = recordOf(json);
                    return isCondition(condition) && record !== undefined ? [{ condition, ...record }] : [];
                },
            ),
        claimReminder: async (condition: Condition, seconds: number): Promise<boolean> =>
            (await redis.set(reminderKey(condition), "1", {
                nx: true,
                expiration: new Date(Date.now() + seconds * MS_PER_SECOND),
            })) !== "",
        end: async (condition: Condition): Promise<boolean> => (await redis.hDel(CONDITIONS_KEY, [condition])) === 1,
        claimNotice: async (condition: Condition, seconds: number): Promise<boolean> =>
            (await redis.set(noticeKey(condition), "1", {
                nx: true,
                expiration: new Date(Date.now() + seconds * MS_PER_SECOND),
            })) !== "",
        recordNotice: async (condition: Condition): Promise<void> => {
            await redis.hSet(NOTICED_KEY, { [condition]: String(Date.now()) });
            await redis.expire(NOTICED_KEY, CONDITIONS_MEMORY_SECONDS);
        },
        endNotice: async (condition: Condition): Promise<boolean> => (await redis.hDel(NOTICED_KEY, [condition])) === 1,
    };
}
