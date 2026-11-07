import type { TriggerContext } from "@devvit/public-api";
import { createClient } from "redis";

/**
 * A real Redis server behind Devvit's Redis interface: the commands the app uses, with Devvit's argument and result
 * shapes, sent as raw commands so that they behave as Redis does, contention and all. Each invocation gets its own
 * view (`viewFor`), which counts the bytes it sends and receives.
 */

/** The client calls the harness makes: raw commands, and closing. */
export type RedisClient = Readonly<{ sendCommand: (args: string[]) => Promise<unknown>; quit: () => Promise<unknown> }>;

/** What the app calls on Devvit's Redis client. */
export type DevvitRedis = Readonly<
    Pick<
        TriggerContext["redis"],
        | "get"
        | "mGet"
        | "set"
        | "del"
        | "incrBy"
        | "expire"
        | "zAdd"
        | "zRem"
        | "zRemRangeByScore"
        | "zRemRangeByRank"
        | "zIncrBy"
        | "zRange"
        | "zScore"
        | "zCard"
        | "hSetNX"
        | "hGet"
        | "hGetAll"
        | "hSet"
        | "hIncrBy"
        | "hDel"
        | "hLen"
        | "hScan"
    >
>;

/** Bytes an invocation sent to Redis and received from it. */
export interface Traffic {
    sent: number;
    received: number;
}

/** How many members Devvit returns from a ZRANGE by score or by lex without a LIMIT, and at most with one. */
const MAX_RANGE_COUNT = 1000;
const MS_PER_SECOND = 1000;

export async function connectRedis(url: string): Promise<RedisClient> {
    // RESP2: replies as flat arrays (HGETALL, ZRANGE WITHSCORES), as the adapter reads them; RESP3 would nest them.
    const client = createClient({ url, RESP: 2 });
    await client.connect();
    return client;
}

function text(reply: unknown): string {
    if (typeof reply === "string") {
        return reply;
    }
    if (reply instanceof Uint8Array) {
        return new TextDecoder().decode(reply);
    }
    return String(reply);
}

function texts(reply: unknown): string[] {
    return Array.isArray(reply) ? reply.map((item: unknown): string => text(item)) : [];
}

function optionalText(reply: unknown): string | undefined {
    return reply === null || reply === undefined ? undefined : text(reply);
}

function pairs(flat: readonly string[]): [string, string][] {
    const result: [string, string][] = [];
    for (let index = 0; index + 1 < flat.length; index += 2) {
        result.push([flat[index] ?? "", flat[index + 1] ?? ""]);
    }
    return result;
}

interface ZMember {
    member: string;
    score: number;
}
type RangeOptions = Readonly<{
    by: "score" | "lex" | "rank";
    reverse?: boolean;
    limit?: Readonly<{ offset: number; count: number }>;
}>;

/** The ZRANGE arguments Devvit sends for these options: a LIMIT of at most 1,000 by score or by lex. */
function rangeArgs(key: string, start: number | string, stop: number | string, options?: RangeOptions): string[] {
    const by = options?.by ?? "rank";
    const args = ["ZRANGE", key, String(start), String(stop)];
    if (by === "rank") {
        return [...args, "WITHSCORES"];
    }
    const offset = options?.limit?.offset ?? 0;
    const count = Math.min(options?.limit?.count ?? MAX_RANGE_COUNT, MAX_RANGE_COUNT);
    const limited = [...args, by === "score" ? "BYSCORE" : "BYLEX", "LIMIT", String(offset), String(count)];
    // Redis refuses WITHSCORES with BYLEX; the app reads lex ranges only from sets scored 0.
    return by === "score" ? [...limited, "WITHSCORES"] : limited;
}

/** A view of `client` for one invocation, counting its traffic. */
export function viewFor(client: RedisClient, traffic: Traffic): DevvitRedis {
    const send = async (args: readonly string[]): Promise<unknown> => {
        traffic.sent += args.reduce((sum: number, arg: string): number => sum + arg.length, 0);
        const reply: unknown = await client.sendCommand([...args]);
        traffic.received += JSON.stringify(reply ?? null).length;
        return reply;
    };
    const number = async (args: readonly string[]): Promise<number> => Number(await send(args));
    return {
        get: async (key: string): Promise<string | undefined> => optionalText(await send(["GET", key])),
        mGet: async (keys: string[]): Promise<(string | null)[]> => {
            const replies: unknown = await send(["MGET", ...keys]);
            return Array.isArray(replies)
                ? replies.map((reply: unknown): string | null => optionalText(reply) ?? null)
                : [];
        },
        set: async (
            key: string,
            value: string,
            options?: Readonly<{ nx?: boolean; expiration?: Date }>,
        ): Promise<string> => {
            const args = ["SET", key, value];
            if (options?.nx === true) {
                args.push("NX");
            }
            if (options?.expiration !== undefined) {
                args.push("PXAT", String(options.expiration.getTime()));
            }
            return optionalText(await send(args)) ?? "";
        },
        del: async (...keys: string[]): Promise<void> => {
            if (keys.length > 0) {
                await send(["DEL", ...keys]);
            }
        },
        incrBy: async (key: string, value: number): Promise<number> => await number(["INCRBY", key, String(value)]),
        expire: async (key: string, seconds: number): Promise<void> => {
            await send(["EXPIRE", key, String(seconds)]);
        },
        zAdd: async (key: string, ...members: ZMember[]): Promise<number> =>
            await number([
                "ZADD",
                key,
                ...members.flatMap(({ member, score }: ZMember): string[] => [String(score), member]),
            ]),
        zRem: async (key: string, members: string[]): Promise<number> => await number(["ZREM", key, ...members]),
        zRemRangeByScore: async (key: string, min: number, max: number): Promise<number> =>
            await number(["ZREMRANGEBYSCORE", key, String(min), String(max)]),
        zRemRangeByRank: async (key: string, start: number, stop: number): Promise<number> =>
            await number(["ZREMRANGEBYRANK", key, String(start), String(stop)]),
        zIncrBy: async (key: string, member: string, value: number): Promise<number> =>
            await number(["ZINCRBY", key, String(value), member]),
        zRange: async (
            key: string,
            start: number | string,
            stop: number | string,
            options?: RangeOptions,
        ): Promise<ZMember[]> => {
            const reply = texts(await send(rangeArgs(key, start, stop, options)));
            return options?.by === "lex"
                ? reply.map((member: string): ZMember => ({ member, score: 0 }))
                : pairs(reply).map(([member, score]: readonly [string, string]): ZMember => ({
                      member,
                      score: Number(score),
                  }));
        },
        zScore: async (key: string, member: string): Promise<number | undefined> => {
            const score = optionalText(await send(["ZSCORE", key, member]));
            return score === undefined ? undefined : Number(score);
        },
        zCard: async (key: string): Promise<number> => await number(["ZCARD", key]),
        hSetNX: async (key: string, field: string, value: string): Promise<number> =>
            await number(["HSETNX", key, field, value]),
        hGet: async (key: string, field: string): Promise<string | undefined> =>
            optionalText(await send(["HGET", key, field])),
        hGetAll: async (key: string): Promise<Record<string, string>> =>
            Object.fromEntries(pairs(texts(await send(["HGETALL", key])))),
        hSet: async (key: string, fieldValues: Readonly<Record<string, string>>): Promise<number> =>
            await number(["HSET", key, ...Object.entries(fieldValues).flat()]),
        hIncrBy: async (key: string, field: string, value: number): Promise<number> =>
            await number(["HINCRBY", key, field, String(value)]),
        hDel: async (key: string, fields: string[]): Promise<number> => await number(["HDEL", key, ...fields]),
        hLen: async (key: string): Promise<number> => await number(["HLEN", key]),
        hScan: async (
            key: string,
            cursor: number,
            pattern?: string,
            count?: number,
        ): Promise<{ cursor: number; fieldValues: { field: string; value: string }[] }> => {
            const args = ["HSCAN", key, String(cursor)];
            if (pattern !== undefined) {
                args.push("MATCH", pattern);
            }
            if (count !== undefined) {
                args.push("COUNT", String(count));
            }
            const reply = await send(args);
            const parts: readonly unknown[] = Array.isArray(reply) ? reply : [];
            const [next, entries] = parts;
            return {
                cursor: Number(text(next)),
                fieldValues: pairs(texts(entries)).map(
                    ([field, value]: readonly [string, string]): { field: string; value: string } => ({
                        field,
                        value,
                    }),
                ),
            };
        },
    };
}

/** Seconds as Redis's EXPIRE takes them, from ms. */
export function secondsOf(ms: number): number {
    return Math.ceil(ms / MS_PER_SECOND);
}
