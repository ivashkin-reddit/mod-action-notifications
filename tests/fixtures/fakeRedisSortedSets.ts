import { vi } from "vitest";
import type { Mock } from "vitest";
import { keep, scoresAt } from "./fakeRedisKeyspace.js";
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
    /**
     * ZRANGE by score (members scored from `start` to `stop`) or by rank (negative ranks count from the end),
     * lowest first: the forms the app uses. Any other form rejects rather than answer differently from Redis.
     */
    readonly zRange: Mock<
        (key: string, start: number, stop: number, options?: Readonly<{ by: string }>) => Promise<ZMember[]>
    >;
}

/** A sorted set's members, lowest score first (ties by member), as Redis orders them. */
export function ranked(scores: Scores): ZMember[] {
    return Object.entries(scores)
        .map(([member, score]: readonly [string, number]): ZMember => ({ member, score }))
        .sort((first: ZMember, second: ZMember): number =>
            first.score === second.score ? first.member.localeCompare(second.member) : first.score - second.score,
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

/**
 * ZRANGE by score (members scored from `start` to `stop`) or by rank (negative ranks count from the end), lowest
 * first. Any other form throws rather than answer differently from Redis.
 */
function rangeOf(
    scores: Scores,
    { start, stop, by }: Readonly<{ start: number; stop: number; by: string | undefined }>,
): ZMember[] {
    const members = ranked(scores);
    if (by === "score") {
        return members.filter(({ score }: ZMember): boolean => score >= start && score <= stop);
    }
    if (by !== "rank") {
        throw new Error(`the fake ZRANGE supports by score and by rank, not ${String(by)}`);
    }
    return members.slice(rankIn(start, members.length), rankIn(stop, members.length) + 1);
}

export function sortedSetCommands(keyspace: Keyspace): SortedSetCommands {
    return {
        zAdd: vi.fn(async (key: string, ...members: readonly ZMember[]): Promise<number> => {
            const scores = scoresAt(keyspace, key);
            const known = Object.keys(scores);
            const added = members.filter(({ member }: ZMember): boolean => !known.includes(member)).length;
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
        zRange: vi.fn(
            async (key: string, start: number, stop: number, options?: Readonly<{ by: string }>): Promise<ZMember[]> =>
                await Promise.resolve(rangeOf(scoresAt(keyspace, key), { start, stop, by: options?.by })),
        ),
    };
}
