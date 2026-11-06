import { vi } from "vitest";
import type { Mock } from "vitest";
import { keep, scoresAt, withinRequestLimit } from "./fakeRedisKeyspace.js";
import type { Keyspace, Scores } from "./fakeRedisKeyspace.js";

export type ZMember = Readonly<{ member: string; score: number }>;

/** The fake Redis's sorted-set commands, as Redis behaves for the forms the app uses. */
export interface SortedSetCommands {
    readonly zAdd: Mock<(key: string, ...members: readonly ZMember[]) => Promise<number>>;
    readonly zRem: Mock<(key: string, members: readonly string[]) => Promise<number>>;
    readonly zRemRangeByScore: Mock<(key: string, min: number, max: number) => Promise<number>>;
    readonly zRemRangeByRank: Mock<(key: string, start: number, stop: number) => Promise<number>>;
    readonly zScore: Mock<(key: string, member: string) => Promise<number | undefined>>;
    /** How many members the sorted set has; 0 when there is none. */
    readonly zCard: Mock<(key: string) => Promise<number>>;
    /** Adds `value` to the member's score, adding the member at 0 first if absent; returns its new score. */
    readonly zIncrBy: Mock<(key: string, member: string, value: number) => Promise<number>>;
    /**
     * ZRANGE by score (members scored from `start` to `stop`), by lex (members from `start` to `stop`, each `[` for
     * inclusive or `(` for exclusive, or `-` and `+` for either end) or by rank (negative ranks count from the end),
     * lowest first. By score and by lex, at most `limit.count` from `limit.offset`, and never more than Devvit's 1,000.
     * Any other form rejects rather than answer differently from Redis.
     */
    readonly zRange: Mock<
        (key: string, start: number | string, stop: number | string, options?: RangeOptions) => Promise<ZMember[]>
    >;
}

/** Members compared as Redis compares them, byte by byte (for the app's ASCII members, by code unit). */
function byMember(first: string, second: string): number {
    if (first === second) {
        return 0;
    }
    return first < second ? -1 : 1;
}

/** A sorted set's members, lowest score first (ties by member), as Redis orders them. */
export function ranked(scores: Scores): ZMember[] {
    return Object.entries(scores)
        .map(([member, score]: readonly [string, number]): ZMember => ({ member, score }))
        .sort((first: ZMember, second: ZMember): number =>
            first.score === second.score ? byMember(first.member, second.member) : first.score - second.score,
        );
}

/** Removes the members `remove` picks (given each one's rank) and returns how many. */
function removeWhere(keyspace: Keyspace, key: string, remove: (member: ZMember, rank: number) => boolean): number {
    const members = ranked(scoresAt(keyspace, key));
    const kept = members.filter((member: ZMember, rank: number): boolean => !remove(member, rank));
    const scores = Object.fromEntries(kept.map(({ member, score }: ZMember): [string, number] => [member, score]));
    keep(keyspace, key, { kind: "zset", scores });
    return members.length - kept.length;
}

/** A rank as Redis reads one: negative ranks count back from the highest. */
function rankIn(rank: number, size: number): number {
    return rank < 0 ? size + rank : rank;
}

/** ZRANGE's LIMIT, which Redis takes only with BYSCORE or BYLEX. */
type RangeLimit = Readonly<{ offset: number; count: number }>;
type RangeOptions = Readonly<{ by: string; limit?: RangeLimit }>;
type Range = Readonly<{ start: number | string; stop: number | string; by: string | undefined }>;

/**
 * The most members Devvit returns from one ZRANGE by score or by lex, and how many it returns when no LIMIT is
 * given (developers.reddit.com/docs/capabilities/server/redis, zRange).
 */
const MAX_RANGE_COUNT = 1000;

/** Whether `member` is on the right side of a lex bound: `-`, `+`, or a value after `[` (inclusive) or `(`. */
function withinLex(member: string, bound: string, side: "min" | "max"): boolean {
    if (bound === "-" || bound === "+") {
        return (bound === "-") === (side === "min");
    }
    // Devvit reads a bound with neither prefix as inclusive.
    const inclusive = !bound.startsWith("(");
    const value = bound.startsWith("(") || bound.startsWith("[") ? bound.slice(1) : bound;
    const order = byMember(member, value);
    return order === 0 ? inclusive : order > 0 === (side === "min");
}

/** The members a ZRANGE by score or by lex picks, before its LIMIT. */
function pickedBy(members: readonly ZMember[], { start, stop, by }: Range): ZMember[] {
    if (by === "score" && typeof start === "number" && typeof stop === "number") {
        return members.filter(({ score }: ZMember): boolean => score >= start && score <= stop);
    }
    if (by === "lex" && typeof start === "string" && typeof stop === "string") {
        return members.filter(
            ({ member }: ZMember): boolean => withinLex(member, start, "min") && withinLex(member, stop, "max"),
        );
    }
    throw new Error(
        `the fake ZRANGE supports numbers by score and strings by lex, not ${String(start)} by ${String(by)}`,
    );
}

function rangeOf(scores: Scores, range: Range, limit: RangeLimit | undefined): ZMember[] {
    const members = ranked(scores);
    const { start, stop, by } = range;
    if (by === "rank" && typeof start === "number" && typeof stop === "number") {
        return members.slice(rankIn(start, members.length), rankIn(stop, members.length) + 1);
    }
    const offset = limit?.offset ?? 0;
    return pickedBy(members, range).slice(offset, offset + Math.min(limit?.count ?? MAX_RANGE_COUNT, MAX_RANGE_COUNT));
}

function zIncrByCommand(keyspace: Keyspace): SortedSetCommands["zIncrBy"] {
    return vi.fn(async (key: string, member: string, value: number): Promise<number> => {
        const scores = scoresAt(keyspace, key);
        const score = (new Map(Object.entries(scores)).get(member) ?? 0) + value;
        keep(keyspace, key, { kind: "zset", scores: { ...scores, [member]: score } });
        return await Promise.resolve(score);
    });
}

function zRangeCommand(keyspace: Keyspace): SortedSetCommands["zRange"] {
    return vi.fn(
        async (
            key: string,
            start: number | string,
            stop: number | string,
            options?: RangeOptions,
        ): Promise<ZMember[]> =>
            await Promise.resolve(rangeOf(scoresAt(keyspace, key), { start, stop, by: options?.by }, options?.limit)),
    );
}

export function sortedSetCommands(keyspace: Keyspace): SortedSetCommands {
    return {
        zAdd: vi.fn(async (key: string, ...members: readonly ZMember[]): Promise<number> => {
            withinRequestLimit("zAdd", [key, members]);
            const scores = scoresAt(keyspace, key);
            const known = new Set(Object.keys(scores));
            const added = members.filter(({ member }: ZMember): boolean => !known.has(member)).length;
            const updated = {
                ...scores,
                ...Object.fromEntries(members.map(({ member, score }: ZMember): [string, number] => [member, score])),
            };
            keep(keyspace, key, { kind: "zset", scores: updated });
            return await Promise.resolve(added);
        }),
        zRem: vi.fn(async (key: string, members: readonly string[]): Promise<number> => {
            const removed = removeWhere(keyspace, key, ({ member }: ZMember): boolean => members.includes(member));
            return await Promise.resolve(removed);
        }),
        zRemRangeByScore: vi.fn(async (key: string, min: number, max: number): Promise<number> => {
            const removed = removeWhere(keyspace, key, ({ score }: ZMember): boolean => score >= min && score <= max);
            return await Promise.resolve(removed);
        }),
        zRemRangeByRank: vi.fn(async (key: string, start: number, stop: number): Promise<number> => {
            const size = Object.keys(scoresAt(keyspace, key)).length;
            const [first, last] = [rankIn(start, size), rankIn(stop, size)];
            const removed = removeWhere(
                keyspace,
                key,
                (_member: ZMember, rank: number): boolean => rank >= first && rank <= last,
            );
            return await Promise.resolve(removed);
        }),
        zScore: vi.fn(
            async (key: string, member: string): Promise<number | undefined> =>
                // Through a Map: a member named like an Object property ("constructor") is not in the set.
                await Promise.resolve(new Map(Object.entries(scoresAt(keyspace, key))).get(member)),
        ),
        zCard: vi.fn(
            async (key: string): Promise<number> => await Promise.resolve(Object.keys(scoresAt(keyspace, key)).length),
        ),
        zIncrBy: zIncrByCommand(keyspace),
        zRange: zRangeCommand(keyspace),
    };
}
