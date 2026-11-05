import type { TriggerContext } from "@devvit/public-api";
import { reportDelivery } from "./conditions.js";
import type { DeliveryConditions } from "./conditions.js";
import { anyDeleted, enqueueQuoting, noteDeleted, queueQuotes, removeDeletedQuotes } from "./deletions.js";
import type { DeletionRedis } from "./deletions.js";
import type { Quoting, SlackMessage, SlackSender } from "./message.js";
import { MAX_AGE_SECONDS, oldest, remove } from "./queue.js";
import type { Queued } from "./queue.js";
import {
    continuationStarted,
    CONTINUE_SOON_MS,
    DRAIN_BUDGET_MS,
    lease,
    releaseLease,
    scheduleDrain,
    scheduleRecovery,
    SEND_INTERVAL_MS,
} from "./schedule.js";
import { attemptDelivery, backoffMs, createWebhookSender, wait } from "./webhook.js";
import type { Delivery } from "./webhook.js";

// The drain's bookkeeping, which expires.
/**
 * When a drain last sent Slack a message, in ms since the epoch: the next drain keeps the pace from it, as each
 * alert that arrives after a drain has finished starts a drain of its own.
 */
const LAST_SENT_KEY = "slack_outbox_last_sent";
/** Long enough to outlast the pause between two messages. */
const LAST_SENT_MEMORY_MS = 60_000;

const MS_PER_SECOND = 1000;
/** Within one drain, a message is retried this many times before the queue waits for a later drain. */
const MAX_RETRIES_PER_DRAIN = 3;
/** A later drain runs this long after Slack failed to take a message, unless Slack said when to retry. */
const RETRY_LATER_MS = 30_000;
type OutboxRedis = DeletionRedis & Readonly<Pick<TriggerContext["redis"], "get" | "set" | "del">>;
type OutboxScheduler = Readonly<Pick<TriggerContext["scheduler"], "runJob">>;

/** What the queue itself needs: enough to forget deleted content, which takes no webhook. */
export type QueueDependencies = Readonly<{ redis: OutboxRedis; scheduler: OutboxScheduler }>;

export type OutboxDependencies = QueueDependencies &
    Readonly<{
        /** An https URL. */
        webhookUrl: string;
        /** Where lasting delivery problems are reported. */
        conditions: DeliveryConditions;
    }>;

export interface SlackOutbox {
    /**
     * Queues the message, then delivers the queue, oldest first, at Slack's pace; sends it directly when the queue
     * cannot be written. A message quoting content already deleted is queued without the quotes. Never rejects.
     */
    readonly send: SlackSender;
    /** Delivers what is queued, as the scheduled job. Rejects when the queue cannot be read. */
    readonly deliverQueued: () => Promise<void>;
}

/** Why a drain stopped: the queue is empty, or what is left waits `afterMs` for a later drain. */
type DrainEnd = Readonly<{ until: "empty" }> | Readonly<{ until: "later"; afterMs: number }>;

type Drain = Readonly<{ outbox: OutboxDependencies; deadline: number }>;

/** When a drain last sent Slack a message; 0 when none has lately. */
async function whenLastSent({ redis }: OutboxDependencies): Promise<number> {
    const at = Number(await redis.get(LAST_SENT_KEY));
    return Number.isFinite(at) ? at : 0;
}

/** Notes that a request went to Slack now. Only the drain holding the lease sends, so drains cannot race on it. */
async function noteSent({ redis }: OutboxDependencies): Promise<void> {
    const now = Date.now();
    await redis.set(LAST_SENT_KEY, String(now), { expiration: new Date(now + LAST_SENT_MEMORY_MS) });
}

/** One message's delivery within a drain: retried after rate limiting and failures, while the drain has time. */
async function deliverWithRetries(drain: Drain, message: SlackMessage, retryCount: number): Promise<Delivery> {
    const delivery = await attemptDelivery(drain.outbox.webhookUrl, message);
    await noteSent(drain.outbox);
    if (
        delivery.outcome !== "retry" ||
        retryCount >= MAX_RETRIES_PER_DRAIN ||
        (delivery.failure.kind === "error" && delivery.failure.ranOutOfTime)
    ) {
        return delivery;
    }
    const delay = delivery.retryAfterMs ?? backoffMs(retryCount);
    if (Date.now() + delay >= drain.deadline) {
        return delivery;
    }
    await wait(delay);
    return await deliverWithRetries(drain, message, retryCount + 1);
}

/** Why a queued message is dropped unsent: it cannot be read, or it was queued over a day ago. */
type DropReason = "unreadable" | "expired";

/**
 * What to send for a queued message, or why to drop it; its version without quotes once content it quotes is
 * deleted, which may happen while it waits, even while this drain is under way.
 */
async function messageToSend({ redis }: OutboxDependencies, queued: Queued): Promise<SlackMessage | DropReason> {
    if (queued.message === undefined) {
        return "unreadable";
    }
    if (Date.now() - queued.queuedAt > MAX_AGE_SECONDS * MS_PER_SECOND) {
        return "expired";
    }
    return queued.quoting !== undefined && (await anyDeleted(redis, queued.quoting.contentIds))
        ? queued.quoting.withoutQuotes
        : queued.message;
}

/** One message's delivery within a drain, reporting what it says about Slack. */
async function deliver(drain: Drain, message: SlackMessage): Promise<Delivery> {
    const delivery = await deliverWithRetries(drain, message, 0);
    await reportDelivery(drain.outbox.conditions, delivery);
    return delivery;
}

/**
 * Drops a queued message unsent. Alerts dropped for their age are a condition, which lasts while Slack does not take
 * them; one that cannot be read is left by another version of the app, and logged.
 */
async function drop({ outbox }: Drain, queued: Queued, reason: DropReason): Promise<void> {
    if (reason === "expired") {
        await outbox.conditions.raise("alerts-expired", "");
    } else {
        console.warn("[outbox] Dropped a queued alert it could not read");
    }
    await remove(outbox.redis, queued);
}

/** Delivers the oldest message, or drops one too old or unreadable; a DrainEnd when the queue must wait. */
async function deliverNext(drain: Drain, queued: Queued): Promise<DrainEnd | undefined> {
    const message = await messageToSend(drain.outbox, queued);
    if (typeof message === "string") {
        await drop(drain, queued, message);
        return undefined;
    }
    const delivery = await deliver(drain, message);
    if (delivery.outcome === "retry") {
        return { until: "later", afterMs: delivery.retryAfterMs ?? RETRY_LATER_MS };
    }
    await remove(drain.outbox.redis, queued);
    return undefined;
}

/** Delivers queued messages one at a time, `SEND_INTERVAL_MS` apart, until the queue empties or must wait. */
async function drainQueue(drain: Drain, lastSentAt: number): Promise<DrainEnd> {
    if (Date.now() >= drain.deadline) {
        return { until: "later", afterMs: CONTINUE_SOON_MS };
    }
    const queued = await oldest(drain.outbox.redis);
    if (queued === undefined) {
        return { until: "empty" };
    }
    const pause = lastSentAt + SEND_INTERVAL_MS - Date.now();
    if (pause > 0) {
        await wait(pause);
    }
    return (await deliverNext(drain, queued)) ?? (await drainQueue(drain, Date.now()));
}

/**
 * Drains the queue while holding the lease; undefined when another drain holds it, and will deliver the queue. Before
 * it lets go, it takes deleted content's quotes out of what is left: only the lease holder does, so none is taken
 * from a message part way through being sent, and a deletion noted while it held the lease is covered.
 */
async function drainUnderLease(outbox: OutboxDependencies): Promise<DrainEnd | undefined> {
    if (!(await lease(outbox))) {
        return undefined;
    }
    try {
        if ((await oldest(outbox.redis)) !== undefined) {
            await scheduleRecovery(outbox);
        }
        const end = await drainQueue({ outbox, deadline: Date.now() + DRAIN_BUDGET_MS }, await whenLastSent(outbox));
        await removeDeletedQuotes(outbox.redis);
        return end;
    } finally {
        await releaseLease(outbox);
    }
}

/** A drain emptied the queue, which is then neither full nor holding alerts a day old. */
async function queueEmptied({ conditions }: OutboxDependencies): Promise<void> {
    await conditions.clear("outbox-full");
    await conditions.clear("alerts-expired");
}

async function deliverQueued(outbox: OutboxDependencies): Promise<void> {
    const end = await drainUnderLease(outbox);
    if (end === undefined) {
        // Another drain holds the lease and will deliver what is queued; should it die first, a recovery does.
        await scheduleRecovery(outbox);
        return;
    }
    if (end.until === "later") {
        await scheduleDrain(outbox, end.afterMs);
        return;
    }
    await queueEmptied(outbox);
    // A message queued after the drain last looked, but before it let go of the lease, found the lease held, so its
    // sender left it to this drain. A later drain delivers it: one trigger delivers for at most one drain's time,
    // however fast messages arrive.
    if ((await oldest(outbox.redis)) !== undefined) {
        await scheduleDrain(outbox, CONTINUE_SOON_MS);
    }
}

/**
 * Alerts as a queue in Redis, delivered oldest first at the pace Slack takes them, so a burst of mod actions is
 * delivered in full rather than rate-limited away. One drain delivers at a time (a lease); what it cannot deliver in
 * its time, or while Slack is failing, waits for a scheduled later drain, and what a drain that dies leaves waits for
 * a recovery drain after its lease expires. A message is delivered at least once: a request Slack took but whose
 * answer was lost, or that a dying drain made, is sent again. Content deleted on Reddit leaves the queue's messages.
 */
export function createSlackOutbox(outbox: OutboxDependencies): SlackOutbox {
    return {
        send: async (message: SlackMessage, quoting?: Quoting): Promise<void> => {
            try {
                if ((await enqueueQuoting(outbox.redis, message, quoting)) > 0) {
                    await outbox.conditions.raise("outbox-full", "");
                }
            } catch (error) {
                // The queue only paces delivery: without it, the alert still goes, straight to Slack, which logs a
                // failure itself.
                console.error("Failed to queue a Slack message; sending it directly:", error);
                await createWebhookSender(outbox.webhookUrl)(message);
                return;
            }
            await deliverQueued(outbox).catch((error: unknown): void => {
                // The message stays queued for the next drain.
                console.error("Failed to deliver queued Slack messages:", error);
            });
        },
        deliverQueued: async (): Promise<void> => {
            await continuationStarted(outbox);
            await deliverQueued(outbox);
        },
    };
}

/**
 * Notes that Reddit deleted this post or comment, by its ID: from now on, each message quoting it is sent and stored
 * without the quotes. Those queued lose them now, unless a drain holds the queue: it takes them out before it lets
 * go. Needs no webhook, as messages wait in the queue while none is set. Rejects when Redis fails.
 */
export async function forgetContent(queue: QueueDependencies, contentId: string): Promise<void> {
    await noteDeleted(queue.redis, contentId);
    if (!(await queueQuotes(queue.redis, contentId)) || !(await lease(queue))) {
        return;
    }
    try {
        await removeDeletedQuotes(queue.redis);
    } finally {
        await releaseLease(queue);
    }
    // A message queued while this held the lease left itself to a drain, as to one under way: a drain follows.
    if ((await oldest(queue.redis)) !== undefined) {
        await scheduleDrain(queue, CONTINUE_SOON_MS);
    }
}
