import { vi } from "vitest";
import type { Mock } from "vitest";
import { hashCommands } from "./fakeRedisHashes.js";
import type { HashCommands } from "./fakeRedisHashes.js";
import { createKeyspace, MS_PER_SECOND, scoresAt, textAt, withinRequestLimit } from "./fakeRedisKeyspace.js";
import type { Keyspace } from "./fakeRedisKeyspace.js";
import { ranked, sortedSetCommands } from "./fakeRedisSortedSets.js";
import type { SortedSetCommands, ZMember } from "./fakeRedisSortedSets.js";

export type { ZMember };

/**
 * A stand-in for Devvit's Redis client: the commands the app uses, with Redis's behaviour for expiry, NX sets,
 * sorted sets and hashes, and Devvit's limit on a request's size. Every command is a vi.fn, so a test can make one
 * fail (`mockRejectedValueOnce`) or count its calls.
 */

type SetOptions = Readonly<{ nx?: boolean; expiration?: Date }>;

interface StringCommands {
    readonly get: Mock<(key: string) => Promise<string | undefined>>;
    /** The string at each key, null where there is none, as Devvit answers. */
    readonly mGet: Mock<(keys: readonly string[]) => Promise<(string | null)[]>>;
    readonly set: Mock<(key: string, value: string, options?: SetOptions) => Promise<string>>;
    readonly del: Mock<(...keys: readonly string[]) => Promise<void>>;
    readonly incrBy: Mock<(key: string, increment: number) => Promise<number>>;
    readonly expire: Mock<(key: string, seconds: number) => Promise<void>>;
}

export interface FakeRedis extends StringCommands, SortedSetCommands, HashCommands {
    /** Live keys, sorted. */
    readonly keys: () => readonly string[];
    /** The members of the sorted set at `key`, lowest score first; none when there is no set. */
    readonly members: (key: string) => readonly string[];
    /** Seconds until `key` expires, or undefined when it does not expire (or does not exist). */
    readonly ttlSeconds: (key: string) => number | undefined;
    /** Writes a value directly, as an earlier app version might have left it. */
    readonly seed: (key: string, value: string) => void;
    /** What `key` holds, whatever its type; undefined when it does not exist. */
    readonly dump: (key: string) => unknown;
}

function stringCommands(keyspace: Keyspace): StringCommands {
    const { live, put, drop } = keyspace;
    return {
        get: vi.fn(async (key: string): Promise<string | undefined> => await Promise.resolve(textAt(keyspace, key))),
        mGet: vi.fn(
            async (keys: readonly string[]): Promise<(string | null)[]> =>
                await Promise.resolve(keys.map((key: string): string | null => textAt(keyspace, key) ?? null)),
        ),
        set: vi.fn(async (key: string, value: string, options?: SetOptions): Promise<string> => {
            withinRequestLimit("set", [key, value]);
            // Like Redis, an NX set leaves an existing key alone and answers nil, which Devvit returns as "".
            if (options?.nx === true && live(key) !== undefined) {
                return await Promise.resolve("");
            }
            put(key, { value: { kind: "string", text: value }, expiresAt: options?.expiration?.getTime() });
            return await Promise.resolve("OK");
        }),
        del: vi.fn(async (...keys: readonly string[]): Promise<void> => {
            for (const key of keys) {
                drop(key);
            }
            await Promise.resolve();
        }),
        incrBy: vi.fn(async (key: string, increment: number): Promise<number> => {
            const next = Number(textAt(keyspace, key) ?? 0) + increment;
            put(key, { value: { kind: "string", text: String(next) }, expiresAt: live(key)?.expiresAt });
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

export function createFakeRedis(): FakeRedis {
    const keyspace = createKeyspace();
    return {
        ...stringCommands(keyspace),
        ...sortedSetCommands(keyspace),
        ...hashCommands(keyspace),
        keys: (): readonly string[] =>
            [...keyspace.keys()].sort((first: string, second: string): number => first.localeCompare(second)),
        members: (key: string): readonly string[] =>
            ranked(scoresAt(keyspace, key)).map(({ member }: ZMember): string => member),
        ttlSeconds: (key: string): number | undefined => {
            const expiresAt = keyspace.live(key)?.expiresAt;
            return expiresAt === undefined ? undefined : (expiresAt - Date.now()) / MS_PER_SECOND;
        },
        seed: (key: string, value: string): void => {
            keyspace.put(key, { value: { kind: "string", text: value }, expiresAt: undefined });
        },
        dump: (key: string): unknown => keyspace.live(key)?.value,
    };
}
