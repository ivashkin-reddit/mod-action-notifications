import { vi } from "vitest";
import type { Mock } from "vitest";
import type { Keyspace } from "./fakeRedisKeyspace.js";

/**
 * The fake Redis's transactions and RENAME, as Devvit gives them. A transaction queues its commands from `multi` and
 * runs them at `exec` in one pass: each fake command changes the keyspace before it first waits, so none of another
 * caller's commands falls between them, as none does in Redis. Like Devvit's, `exec` answers each command's result in
 * order, null for a missing value. WATCH aborting a transaction is not modelled: nothing the app watches is written.
 */

/** A fake transaction: the commands the app queues in one, and `exec`. */
export interface FakeTransaction {
    readonly multi: Mock<() => Promise<void>>;
    readonly hSetNX: Mock<(key: string, field: string, value: string) => Promise<FakeTransaction>>;
    readonly hIncrBy: Mock<(key: string, field: string, value: number) => Promise<FakeTransaction>>;
    readonly hSet: Mock<(key: string, fieldValues: Readonly<Record<string, string>>) => Promise<FakeTransaction>>;
    readonly hGet: Mock<(key: string, field: string) => Promise<FakeTransaction>>;
    readonly expire: Mock<(key: string, seconds: number) => Promise<FakeTransaction>>;
    /** Runs the queued commands, and answers their results in order. */
    readonly exec: Mock<() => Promise<unknown[]>>;
}

export interface TransactionCommands {
    /** Starts a transaction; the key is not watched. The app watches one key, which nothing writes. */
    readonly watch: Mock<(key: string) => Promise<FakeTransaction>>;
    /** Moves the key's value and expiry to `newKey`, replacing what was there; rejects when the key does not exist. */
    readonly rename: Mock<(key: string, newKey: string) => Promise<string>>;
}

type QueuedCommand = () => Promise<unknown>;

/** The commands a transaction runs: the fake's own, so a transaction behaves as the same commands sent alone. */
type Runner = Readonly<{
    hSetNX: (key: string, field: string, value: string) => Promise<number>;
    hIncrBy: (key: string, field: string, value: number) => Promise<number>;
    hSet: (key: string, fieldValues: Readonly<Record<string, string>>) => Promise<number>;
    hGet: (key: string, field: string) => Promise<string | undefined>;
    expire: (key: string, seconds: number) => Promise<void>;
}>;

function transaction(run: Runner): FakeTransaction {
    const queued: QueuedCommand[] = [];
    const tx: FakeTransaction = {
        multi: vi.fn(async (): Promise<void> => {
            await Promise.resolve();
        }),
        hSetNX: vi.fn(async (key: string, field: string, value: string): Promise<FakeTransaction> => {
            queued.push(async (): Promise<number> => await run.hSetNX(key, field, value));
            return await Promise.resolve(tx);
        }),
        hIncrBy: vi.fn(async (key: string, field: string, value: number): Promise<FakeTransaction> => {
            queued.push(async (): Promise<number> => await run.hIncrBy(key, field, value));
            return await Promise.resolve(tx);
        }),
        hSet: vi.fn(async (key: string, fieldValues: Readonly<Record<string, string>>): Promise<FakeTransaction> => {
            queued.push(async (): Promise<number> => await run.hSet(key, fieldValues));
            return await Promise.resolve(tx);
        }),
        hGet: vi.fn(async (key: string, field: string): Promise<FakeTransaction> => {
            queued.push(async (): Promise<string | null> => (await run.hGet(key, field)) ?? null);
            return await Promise.resolve(tx);
        }),
        expire: vi.fn(async (key: string, seconds: number): Promise<FakeTransaction> => {
            queued.push(async (): Promise<number> => {
                await run.expire(key, seconds);
                return 1;
            });
            return await Promise.resolve(tx);
        }),
        exec: vi.fn(async (): Promise<unknown[]> => {
            // Every command starts before any is awaited, so they all change the keyspace in this one pass.
            const started = queued.splice(0).map(async (command: QueuedCommand): Promise<unknown> => await command());
            return await Promise.all(started);
        }),
    };
    return tx;
}

export function transactionCommands(keyspace: Keyspace, run: Runner): TransactionCommands {
    return {
        watch: vi.fn(async (): Promise<FakeTransaction> => await Promise.resolve(transaction(run))),
        rename: vi.fn(async (key: string, newKey: string): Promise<string> => {
            const entry = keyspace.live(key);
            if (entry === undefined) {
                throw new Error("ERR no such key");
            }
            keyspace.put(newKey, entry);
            keyspace.drop(key);
            return await Promise.resolve("OK");
        }),
    };
}
