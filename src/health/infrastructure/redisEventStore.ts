import type { TriggerContext } from "@devvit/public-api";
import type { EventStore } from "../application/ports.js";
import { dayOf, isHealthEvent } from "../domain/events.js";
import type { Counts, HealthEvent, LastSeen } from "../domain/events.js";

/** When each event last happened: a hash of ms since the epoch, by event, kept a week from the last. */
const LAST_KEY = "health:last";
/** A week. */
const LAST_MEMORY_SECONDS = 604_800;
/** Eight days: the daily summary reads the day before. */
const COUNT_MEMORY_SECONDS = 691_200;

/** A UTC day's counts: a hash of how many of each event it saw. */
function countKey(day: string): string {
    return `health:count:${day}`;
}

type EventRedis = Readonly<Pick<TriggerContext["redis"], "hSet" | "hIncrBy" | "hGetAll" | "expire">>;

/** The hash's numbers by event, leaving out fields this version does not know. */
function byEvent(fields: Readonly<Record<string, string>>): Partial<Record<HealthEvent, number>> {
    return Object.fromEntries(
        Object.entries(fields)
            .filter(
                ([event, value]: readonly [string, string]): boolean =>
                    isHealthEvent(event) && Number.isFinite(Number(value)),
            )
            .map(([event, value]: readonly [string, string]): readonly [string, number] => [event, Number(value)]),
    );
}

export function createRedisEventStore(redis: EventRedis): EventStore {
    return {
        note: async (event: HealthEvent, count: number, at: number): Promise<void> => {
            await redis.hSet(LAST_KEY, { [event]: String(at) });
            await redis.expire(LAST_KEY, LAST_MEMORY_SECONDS);
            const key = countKey(dayOf(at));
            await redis.hIncrBy(key, event, count);
            await redis.expire(key, COUNT_MEMORY_SECONDS);
        },
        lastSeen: async (): Promise<LastSeen> => byEvent(await redis.hGetAll(LAST_KEY)),
        counts: async (day: string): Promise<Counts> => byEvent(await redis.hGetAll(countKey(day))),
    };
}
