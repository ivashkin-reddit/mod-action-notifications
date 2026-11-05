import { vi } from "vitest";
import type { Mock } from "vitest";

/**
 * A stand-in for Devvit's Redis client: the commands the app uses, with Redis's behaviour for expiry, NX sets and
 * sorted sets. Every command is a vi.fn, so a test can make one fail (`mockRejectedValueOnce`) or count its calls.
 */

const MS_PER_SECOND = 1000;
const WRONG_TYPE = "WRONGTYPE Operation against a key holding the wrong kind of value";

type SetOptions = Readonly<{ nx?: boolean; expiration?: Date }>;
export type ZMember = Readonly<{ member: string; score: number }>;
type Scores = Readonly<Record<string, number>>;

export interface FakeRedis {
    readonly get: Mock<(key: string) => Promise<string | undefined>>;
    readonly set: Mock<(key: string, value: string, options?: SetOptions) => Promise<string>>;
    readonly del: Mock<(...keys: readonly string[]) => Promise<void>>;
    readonly incrBy: Mock<(key: string, increment: number) => Promise<number>>;
    readonly expire: Mock<(key: string, seconds: number) => Promise<void>>;
    readonly zAdd: Mock<(key: string, ...members: readonly ZMember[]) => Promise<number>>;
    readonly zRem: Mock<(key: string, members: readonly string[]) => Promise<number>>;
    readonly zRemRangeByScore: Mock<(key: string, min: number, max: number) => Promise<number>>;
    readonly zRemRangeByRank: Mock<(key: string, start: number, stop: number) => Promise<number>>;
    readonly zScore: Mock<(key: string, member: string) => Promise<number | undefined>>;
    /**
     * ZRANGE by score (members scored from `start` to `stop`) or by rank (negative ranks count from the end),
     * lowest first: the forms the app uses. Any other form rejects rather than answer differently from Redis.
     */
    readonly zRange: Mock<
        (key: string, start: number, stop: number, options?: Readonly<{ by: string }>) => Promise<ZMember[]>
    >;
    /** Live keys, sorted. */
    readonly keys: () => readonly string[];
    /** The members of the sorted set at `key`, lowest score first; none when there is no set. */
    readonly members: (key: string) => readonly string[];
    /** Seconds until `key` expires, or undefined when it does not expire (or does not exist). */
    readonly ttlSeconds: (key: string) => number | undefined;
    /** Writes a value directly, as an earlier app version might have left it. */
    readonly seed: (key: string, value: string) => void;
}

/** A string, or a sorted set's scores by member. */
type Entry = Readonly<{ value: string | Scores; expiresAt: number | undefined }>;

/** The keys and what they hold; `live` drops a key that has expired. */
type Keyspace = Readonly<{
    live: (key: string) => Entry | undefined;
    put: (key: string, entry: Entry) => void;
    drop: (key: string) => void;
    keys: () => readonly string[];
}>;

function createKeyspace(): Keyspace {
    const entries = new Map<string, Entry>();
    const live = (key: string): Entry | undefined => {
        const entry = entries.get(key);
        if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
            entries.delete(key);
            return undefined;
        }
        return entry;
    };
    return {
        live,
        put: (key: string, entry: Entry): void => {
            entries.set(key, entry);
        },
        drop: (key: string): void => {
            entries.delete(key);
        },
        keys: (): readonly string[] => [...entries.keys()].filter((key: string): boolean => live(key) !== undefined),
    };
}

type StringCommands = Pick<FakeRedis, "get" | "set" | "del" | "incrBy" | "expire">;

function stringCommands({ live, put, drop }: Keyspace): StringCommands {
    return {
        get: vi.fn(async (key: string): Promise<string | undefined> => {
            const value = live(key)?.value;
            if (value !== undefined && typeof value !== "string") {
                throw new TypeError(WRONG_TYPE);
            }
            return await Promise.resolve(value);
        }),
        set: vi.fn(async (key: string, value: string, options?: SetOptions): Promise<string> => {
            // Like Redis, an NX set leaves an existing key alone and answers nil, which Devvit returns as "".
            if (options?.nx === true && live(key) !== undefined) {
                return await Promise.resolve("");
            }
            put(key, { value, expiresAt: options?.expiration?.getTime() });
            return await Promise.resolve("OK");
        }),
        del: vi.fn(async (...keys: readonly string[]): Promise<void> => {
            for (const key of keys) {
                drop(key);
            }
            await Promise.resolve();
        }),
        incrBy: vi.fn(async (key: string, increment: number): Promise<number> => {
            const entry = live(key);
            const next = (entry === undefined ? 0 : Number(entry.value)) + increment;
            put(key, { value: String(next), expiresAt: entry?.expiresAt });
            return await Promise.resolve(next);
        }),
        expire: vi.fn(async (key: string, seconds: number): Promise<void> => {
            const entry = live(key);
            if (entry !== undefined) {
                put(key, { ...entry, expiresAt: Date.now() + seconds * MS_PER_SECOND });
            }
            await Promise.resolve();
        }),
    };
}

/** The sorted set at `key`; {} when there is none. */
function scoresAt({ live }: Keyspace, key: string): Scores {
    const value = live(key)?.value ?? {};
    if (typeof value === "string") {
        throw new TypeError(WRONG_TYPE);
    }
    return value;
}

/** A sorted set's members, lowest score first (ties by member), as Redis orders them. */
function ranked(scores: Scores): ZMember[] {
    return Object.entries(scores)
        .map(([member, score]: readonly [string, number]): ZMember => ({ member, score }))
        .sort((first: ZMember, second: ZMember): number =>
            first.score === second.score ? first.member.localeCompare(second.member) : first.score - second.score,
        );
}

/** Removes the members `remove` picks (given each one's rank) and returns how many; like Redis, an emptied set goes. */
function removeWhere(keyspace: Keyspace, key: string, remove: (member: ZMember, rank: number) => boolean): number {
    const members = ranked(scoresAt(keyspace, key));
    const kept = members.filter((member: ZMember, rank: number): boolean => !remove(member, rank));
    if (kept.length === 0) {
        keyspace.drop(key);
    } else {
        const value = Object.fromEntries(kept.map(({ member, score }: ZMember): [string, number] => [member, score]));
        keyspace.put(key, { value, expiresAt: keyspace.live(key)?.expiresAt });
    }
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

type SortedSetCommands = Pick<
    FakeRedis,
    "zAdd" | "zRem" | "zRemRangeByScore" | "zRemRangeByRank" | "zScore" | "zRange"
>;

function sortedSetCommands(keyspace: Keyspace): SortedSetCommands {
    return {
        zAdd: vi.fn(async (key: string, ...members: readonly ZMember[]): Promise<number> => {
            const scores = scoresAt(keyspace, key);
            const known = Object.keys(scores);
            const added = members.filter(({ member }: ZMember): boolean => !known.includes(member)).length;
            const value = {
                ...scores,
                ...Object.fromEntries(members.map(({ member, score }: ZMember): [string, number] => [member, score])),
            };
            keyspace.put(key, { value, expiresAt: keyspace.live(key)?.expiresAt });
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
        zRange: vi.fn(
            async (key: string, start: number, stop: number, options?: Readonly<{ by: string }>): Promise<ZMember[]> =>
                await Promise.resolve(rangeOf(scoresAt(keyspace, key), { start, stop, by: options?.by })),
        ),
    };
}

export function createFakeRedis(): FakeRedis {
    const keyspace = createKeyspace();
    return {
        ...stringCommands(keyspace),
        ...sortedSetCommands(keyspace),
        keys: (): readonly string[] =>
            [...keyspace.keys()].sort((first: string, second: string): number => first.localeCompare(second)),
        members: (key: string): readonly string[] =>
            ranked(scoresAt(keyspace, key)).map(({ member }: ZMember): string => member),
        ttlSeconds: (key: string): number | undefined => {
            const expiresAt = keyspace.live(key)?.expiresAt;
            return expiresAt === undefined ? undefined : (expiresAt - Date.now()) / MS_PER_SECOND;
        },
        seed: (key: string, value: string): void => {
            keyspace.put(key, { value, expiresAt: undefined });
        },
    };
}
