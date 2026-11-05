import type { TriggerContext } from "@devvit/public-api";
import type { Quoting, SlackMessage } from "./message.js";
import { enqueue, MAX_AGE_SECONDS, quotingMessages, replaceWithoutQuotes } from "./queue.js";
import type { QueuedQuoting, QueueRedis } from "./queue.js";

const MS_PER_SECOND = 1000;

/**
 * The posts and comments Reddit deleted, by ID, each scored by when the app heard of it, so no message, queued before
 * or after, is sent quoting one. Holds IDs only.
 */
const DELETED_KEY = "slack_outbox_deleted";
/** How long a deletion is kept: a second longer than a message can wait, so even one queued as it was noted is covered. */
const KEPT_SECONDS = MAX_AGE_SECONDS + 1;

export type DeletionRedis = QueueRedis & Readonly<Pick<TriggerContext["redis"], "zRemRangeByScore" | "zScore">>;

export async function noteDeleted(redis: DeletionRedis, contentId: string): Promise<void> {
    const now = Date.now();
    await redis.zAdd(DELETED_KEY, { member: contentId, score: now });
    await redis.expire(DELETED_KEY, KEPT_SECONDS);
    await redis.zRemRangeByScore(DELETED_KEY, Number.NEGATIVE_INFINITY, now - KEPT_SECONDS * MS_PER_SECOND);
}

/** Whether Reddit deleted any of these posts and comments. */
export async function anyDeleted(redis: DeletionRedis, contentIds: readonly string[]): Promise<boolean> {
    const scores = await Promise.all(
        contentIds.map(
            async (contentId: string): Promise<number | undefined> => await redis.zScore(DELETED_KEY, contentId),
        ),
    );
    return scores.some((score: number | undefined): boolean => score !== undefined);
}

/**
 * Queues the message, without its quotes when content it quotes is already deleted, so they are never stored; returns
 * how many of the oldest messages it pushed out of a full queue.
 */
export async function enqueueQuoting(
    redis: DeletionRedis,
    message: SlackMessage,
    quoting: Quoting | undefined,
): Promise<number> {
    return quoting !== undefined && (await anyDeleted(redis, quoting.contentIds))
        ? await enqueue(redis, quoting.withoutQuotes, undefined)
        : await enqueue(redis, message, quoting);
}

function quotesAny(queued: QueuedQuoting, contentIds: readonly string[]): boolean {
    return queued.quoting.contentIds.some((contentId: string): boolean => contentIds.includes(contentId));
}

/** Whether a queued message quotes this post or comment. */
export async function queueQuotes(redis: DeletionRedis, contentId: string): Promise<boolean> {
    return (await quotingMessages(redis)).some((queued: QueuedQuoting): boolean =>
        queued.quoting.contentIds.includes(contentId),
    );
}

/**
 * Puts each queued message that quotes deleted content in its place without the quotes. Only the holder of the
 * queue's lease calls it, so no drain is part way through sending one of them.
 */
export async function removeDeletedQuotes(redis: DeletionRedis): Promise<void> {
    const quoting = await quotingMessages(redis);
    if (quoting.length === 0) {
        return;
    }
    const deleted = (await redis.zRange(DELETED_KEY, 0, -1, { by: "rank" })).map(
        ({ member }: Readonly<{ member: string }>): string => member,
    );
    await Promise.all(
        quoting
            .filter((queued: QueuedQuoting): boolean => quotesAny(queued, deleted))
            .map(async (queued: QueuedQuoting): Promise<void> => {
                await replaceWithoutQuotes(redis, queued);
            }),
    );
}
