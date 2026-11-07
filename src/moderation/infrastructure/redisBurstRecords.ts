import type { TriggerContext } from "@devvit/public-api";
import type { BurstJoin, BurstRecords } from "../application/ports.js";
import type { ModeratorRef } from "../domain/activity.js";
import type { Burst, BurstCounts, RemovalType } from "../domain/burst.js";
import { keyPart } from "./redisModerationRecords.js";

const MS_PER_SECOND = 1000;
/** A burst is kept an hour after its last write: a burst whose summary ran is closed long before. */
const BURST_TTL_SECONDS = 3600;
/** How long a run's or a rescue's claim is kept: longer than a burst lives. */
const CLAIM_TTL_SECONDS = 3600;
/** Watched by each join's transaction, and written by nothing, so no join's transaction aborts another's. */
const UNWRITTEN_KEY = "mod_actions:burst_tx";
/** A join's transaction answers one result for each command it queues. */
const JOIN_RESULTS = 6;

/**
 * The commands a join queues in a transaction, as Devvit's transaction client takes them: each answers the client, and
 * `exec` the results in order.
 */
export type BurstTransaction = Readonly<{
    multi: () => Promise<unknown>;
    hSetNX: (key: string, field: string, value: string) => Promise<unknown>;
    hIncrBy: (key: string, field: string, value: number) => Promise<unknown>;
    hSet: (key: string, fieldValues: Readonly<Record<string, string>>) => Promise<unknown>;
    expire: (key: string, seconds: number) => Promise<unknown>;
    hGet: (key: string, field: string) => Promise<unknown>;
    exec: () => Promise<unknown[]>;
}>;

export type BurstRedis = Readonly<
    Pick<TriggerContext["redis"], "del" | "expire" | "hGetAll" | "hSet" | "rename" | "set">
> &
    Readonly<{ watch: (key: string) => Promise<BurstTransaction> }>;

// Installations hold values under these keys, in these shapes.
/**
 * The account's open burst: a hash of `opened`, `last`, `due` and `progressAt` (ms since the epoch) and a count for
 * each removal type. Metadata only: an account's name, counts and times.
 */
function burstKey({ subredditName, moderatorName }: ModeratorRef): string {
    return `mod_actions:burst:${keyPart(subredditName)}:${keyPart(moderatorName)}`;
}

/** Where a burst goes as the run due at `due` closes it, so a removal after opens a new one. */
function closingKey({ subredditName, moderatorName }: ModeratorRef, due: number): string {
    return `mod_actions:burst_closing:${keyPart(subredditName)}:${keyPart(moderatorName)}:${String(due)}`;
}

/** Present once the run due at `due` has started. */
function runKey({ subredditName, moderatorName }: ModeratorRef, due: number): string {
    return `mod_actions:burst_run:${keyPart(subredditName)}:${keyPart(moderatorName)}:${String(due)}`;
}

/** Present once a removal has scheduled again the summary overdue since `since`. */
function rescueKey({ subredditName, moderatorName }: ModeratorRef, since: number): string {
    return `mod_actions:burst_rescue:${keyPart(subredditName)}:${keyPart(moderatorName)}:${String(since)}`;
}

/** A stored time; undefined for none, or for a value this app did not write. */
function timeOf(value: unknown): number | undefined {
    const time = typeof value === "string" && value !== "" ? Number(value) : Number.NaN;
    return Number.isFinite(time) ? time : undefined;
}

/** The burst a hash holds; undefined for none, or for one with no opening time. */
function burstOf(hash: Readonly<Record<string, string>>): Burst | undefined {
    // Through a Map: a field named like an Object property is not mistaken for one.
    const fields: ReadonlyMap<string, string> = new Map(Object.entries(hash));
    const countOf = (type: RemovalType): number => timeOf(fields.get(type)) ?? 0;
    const opened = timeOf(fields.get("opened"));
    if (opened === undefined) {
        return undefined;
    }
    const counts: BurstCounts = {
        removelink: countOf("removelink"),
        removecomment: countOf("removecomment"),
        spamlink: countOf("spamlink"),
        spamcomment: countOf("spamcomment"),
    };
    return {
        opened,
        last: timeOf(fields.get("last")) ?? opened,
        due: timeOf(fields.get("due")),
        progressAt: timeOf(fields.get("progressAt")),
        counts,
    };
}

/**
 * Whether HSETNX set the field. Devvit's `exec` answers each result as the reply's type: HSETNX's integer reply as a
 * number, which a boolean reply would also mean.
 */
function wasSet(result: unknown): boolean {
    return result === 1 || result === true;
}

async function claim(redis: BurstRedis, key: string): Promise<boolean> {
    return (
        (await redis.set(key, "1", {
            nx: true,
            expiration: new Date(Date.now() + CLAIM_TTL_SECONDS * MS_PER_SECOND),
        })) !== ""
    );
}

/** Writes fields of the burst, keeping it an hour from now. */
async function write(
    redis: BurstRedis,
    account: ModeratorRef,
    fields: Readonly<Record<string, string>>,
): Promise<void> {
    const key = burstKey(account);
    await redis.hSet(key, fields);
    await redis.expire(key, BURST_TTL_SECONDS);
}

/** A removal's change to its burst: its type, and when the app handled it, in ms since the epoch. */
type Change = Readonly<{ type: RemovalType; now: number }>;

/** Queues a join's commands: open the burst if none is, count the removal, note it, keep the burst, read it back. */
async function queueJoin(tx: BurstTransaction, key: string, { type, now }: Change): Promise<void> {
    await tx.multi();
    await tx.hSetNX(key, "opened", String(now));
    await tx.hIncrBy(key, type, 1);
    await tx.hSet(key, { last: String(now) });
    await tx.expire(key, BURST_TTL_SECONDS);
    await tx.hGet(key, "due");
    await tx.hGet(key, "opened");
}

/** What a join's results say; rejects when they are not one for each command, as nothing could then be read. */
function joinOf(results: readonly unknown[], now: number): BurstJoin {
    if (results.length !== JOIN_RESULTS) {
        throw new Error(`a burst's transaction answered ${String(results.length)} results for ${String(JOIN_RESULTS)}`);
    }
    // In the order queueJoin queues them: HSETNX opened, HINCRBY, HSET last, EXPIRE, HGET due, HGET opened.
    const [openedSet, , , , due, openedAt] = results;
    return { opened: wasSet(openedSet), openedAt: timeOf(openedAt) ?? now, due: timeOf(due) };
}

/**
 * Counts the removal, and opens the burst when none is open, in one transaction: a join either comes wholly before a
 * run renames the burst away, and is in its total, or wholly after, and opens the next burst.
 */
async function join(redis: BurstRedis, account: ModeratorRef, change: Change): Promise<BurstJoin> {
    const tx = await redis.watch(UNWRITTEN_KEY);
    await queueJoin(tx, burstKey(account), change);
    return joinOf(await tx.exec(), change.now);
}

/** Takes the burst out of the way, then reads and deletes it; undefined when none was open. */
async function close(redis: BurstRedis, account: ModeratorRef, due: number): Promise<Burst | undefined> {
    const key = burstKey(account);
    const closing = closingKey(account, due);
    try {
        await redis.rename(key, closing);
    } catch (error) {
        // Redis refuses to rename a key that does not exist: the burst expired, or another run closed it.
        if (burstOf(await redis.hGetAll(key)) === undefined) {
            return undefined;
        }
        throw error;
    }
    const burst = burstOf(await redis.hGetAll(closing));
    await redis.del(closing);
    return burst;
}

/** Open bursts of removals in Redis, by account. */
export function createRedisBurstRecords(redis: BurstRedis): BurstRecords {
    return {
        join: async (account: ModeratorRef, type: RemovalType, now: number): Promise<BurstJoin> =>
            await join(redis, account, { type, now }),
        setDue: async (account: ModeratorRef, due: number): Promise<void> => {
            await write(redis, account, { due: String(due) });
        },
        read: async (account: ModeratorRef): Promise<Burst | undefined> =>
            burstOf(await redis.hGetAll(burstKey(account))),
        noteProgress: async (account: ModeratorRef, at: number): Promise<void> => {
            await write(redis, account, { progressAt: String(at) });
        },
        close: async (account: ModeratorRef, due: number): Promise<Burst | undefined> =>
            await close(redis, account, due),
        discard: async (account: ModeratorRef): Promise<void> => {
            await redis.del(burstKey(account));
        },
        claimRun: async (account: ModeratorRef, due: number): Promise<boolean> =>
            await claim(redis, runKey(account, due)),
        claimRescue: async (account: ModeratorRef, since: number): Promise<boolean> =>
            await claim(redis, rescueKey(account, since)),
    };
}
