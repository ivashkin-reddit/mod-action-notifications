import type { RedisClient } from "./realRedis.js";

/**
 * Seeds Redis with what an installation accumulates, in the app's own key layout, at a volume: 1 for a busy
 * subreddit's usual state, 10 and 100 for ten and a hundred times that. Each structure stops at the bound the app
 * keeps it to, as the app's own writes would. Written in batches, as the app's writes would never be.
 */

export type Volume = 1 | 10 | 100;

/** What a busy subreddit holds at volume 1, by structure; times the volume, up to the app's bounds. */
const BASE = {
    /** Alerts in Slack that quote content: entries in the sent-alert indexes. Bound: 100,000. */
    sentEntries: 2000,
    /** Items waiting for a moderator. Bound: 10,000. */
    awaiting: 1000,
    /** Posts and comments deleted in the last day. No bound: every deletion for a day. */
    deleted: 2000,
    /** Moderators' last actions. */
    moderators: 20,
    /** Approvals remembered for edits after them. */
    approvals: 1000,
    /** Threads with removals today. Bound: 10,000. */
    threads: 500,
} as const;

const BOUNDS = { sentEntries: 100_000, awaiting: 10_000, threads: 10_000 } as const;
const BATCH = 1000;
const DAY_MS = 86_400_000;

async function inBatches(count: number, write: (from: number, to: number) => Promise<unknown>): Promise<void> {
    for (let from = 0; from < count; from += BATCH) {
        await write(from, Math.min(from + BATCH, count));
    }
}

function range(from: number, to: number): number[] {
    return Array.from({ length: to - from }, (_unused: unknown, index: number): number => from + index);
}

function today(now: number): string {
    return new Date(now).toISOString().slice(0, 10);
}

/** Seeds the volume; returns how many of each structure it wrote. */
export async function seed(
    client: RedisClient,
    volume: Volume,
    now = Date.now(),
): Promise<Readonly<Record<string, number>>> {
    const counts = {
        sentEntries: Math.min(BASE.sentEntries * volume, BOUNDS.sentEntries),
        awaiting: Math.min(BASE.awaiting * volume, BOUNDS.awaiting),
        deleted: BASE.deleted * volume,
        moderators: BASE.moderators * volume,
        approvals: BASE.approvals * volume,
        threads: Math.min(BASE.threads * volume, BOUNDS.threads),
    };
    const sentAt = (index: number): number => now - (index % 80) * DAY_MS;
    await inBatches(counts.sentEntries, async (from: number, to: number): Promise<void> => {
        const entries = range(from, to).map(
            (index: number): string => `t1_s${String(index)} C0123MODS ${String(index)}.000001`,
        );
        await client.sendCommand([
            "ZADD",
            "slack_outbox_sent_by_content",
            ...entries.flatMap((entry: string): string[] => ["0", entry]),
        ]);
        await client.sendCommand([
            "ZADD",
            "slack_outbox_sent_by_time",
            ...entries.flatMap((entry: string, offset: number): string[] => [String(sentAt(from + offset)), entry]),
        ]);
        await client.sendCommand([
            "MSET",
            ...range(from, to).flatMap((index: number): string[] => [
                `slack_outbox_sent_alert:C0123MODS:${String(index)}.000001`,
                JSON.stringify({ text: "An alert, as it reads without quotes", channel: "C0123MODS" }),
            ]),
        ]);
    });
    await inBatches(counts.awaiting, async (from: number, to: number): Promise<void> => {
        await client.sendCommand([
            "HSET",
            "stats:awaiting",
            ...range(from, to).flatMap((index: number): string[] => [
                `t1_w${String(index)}`,
                `${String(now - index * 1000)}:reported`,
            ]),
        ]);
    });
    await inBatches(counts.deleted, async (from: number, to: number): Promise<void> => {
        await client.sendCommand([
            "ZADD",
            "slack_outbox_deleted",
            ...range(from, to).flatMap((index: number): string[] => [
                String(now - (index % 86_000) * 1000),
                `t1_d${String(index)}`,
            ]),
        ]);
    });
    await client.sendCommand([
        "HSET",
        "security:last_action",
        ...range(0, counts.moderators).flatMap((index: number): string[] => [
            `moderator${String(index)}`,
            String(now - index * DAY_MS),
        ]),
    ]);
    await inBatches(counts.approvals, async (from: number, to: number): Promise<void> => {
        await client.sendCommand([
            "MSET",
            ...range(from, to).flatMap((index: number): string[] => [
                `approved_edits:approved:t1_a${String(index)}`,
                JSON.stringify({ approver: "ModA", at: now - index * 1000 }),
            ]),
        ]);
    });
    await inBatches(counts.threads, async (from: number, to: number): Promise<void> => {
        await client.sendCommand([
            "ZADD",
            `stats:threads:${today(now)}`,
            ...range(from, to).flatMap((index: number): string[] => [String(1 + (index % 50)), `t3_t${String(index)}`]),
        ]);
    });
    return counts;
}
