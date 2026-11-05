import type { TriggerContext } from "@devvit/public-api";
import { anyDeleted, enqueueQuoting, noteDeleted, queueQuotes, removeDeletedQuotes } from "./deletions.js";
import type { DeletionRedis } from "./deletions.js";
import type { Quoting, SlackMessage, SlackSender } from "./message.js";
import { MAX_AGE_SECONDS, oldest, remove } from "./queue.js";
import type { Queued } from "./queue.js";
import { attemptDelivery, backoffMs, createWebhookSender, logFailure, wait } from "./webhook.js";
import type { Delivery } from "./webhook.js";

/** The scheduler job that delivers what an earlier drain left queued; the composition root registers it. */
export const OUTBOX_JOB_NAME = "slackOutbox";

// The queue's bookkeeping, each key of which expires.
const LEASE_KEY = "slack_outbox_lease";
/** Present while a drain is scheduled to continue where one left off. */
const DRAIN_SCHEDULED_KEY = "slack_outbox_drain_scheduled";
/** Present while a drain is scheduled to follow one that may die before it finishes. */
const RECOVERY_SCHEDULED_KEY = "slack_outbox_recovery_scheduled";
/**
 * When a drain last sent Slack a message, in ms since the epoch: the next drain keeps the pace from it, as each
 * alert that arrives after a drain has finished starts a drain of its own.
 */
const LAST_SENT_KEY = "slack_outbox_last_sent";
/** Long enough to outlast the pause between two messages. */
const LAST_SENT_MEMORY_MS = 60_000;

const MS_PER_SECOND = 1000;
/** Slack takes about one message a second from a webhook. */
const SEND_INTERVAL_MS = 1100;
/** One drain starts delivering for at most this long, so the trigger or job running it finishes well within its time. */
const DRAIN_BUDGET_MS = 10_000;
/** Devvit ends an HTTP request after this long (developers.reddit.com/docs, 0.15, HTTP Fetch: "HTTP timeout limit"). */
const FETCH_TIMEOUT_MS = 30_000;
/** The Redis commands a drain makes after its last request. */
const LEASE_MARGIN_MS = 5000;
/**
 * Longer than any drain can hold it: its budget, then a pause before the next message, then a request that runs
 * to the fetch timeout. So a drain never outlives its lease, and letting go of the lease never frees another's; a
 * drain that dies holds the queue for at most this long.
 */
const LEASE_MS = DRAIN_BUDGET_MS + SEND_INTERVAL_MS + FETCH_TIMEOUT_MS + LEASE_MARGIN_MS;
/** Within one drain, a message is retried this many times before the queue waits for a later drain. */
const MAX_RETRIES_PER_DRAIN = 3;
/** A later drain runs this long after Slack failed to take a message, unless Slack said when to retry. */
const RETRY_LATER_MS = 30_000;
/** A later drain runs this soon after one that used up its time with messages left. */
const CONTINUE_SOON_MS = 1000;

type OutboxRedis = DeletionRedis & Readonly<Pick<TriggerContext["redis"], "get" | "set" | "del">>;
type OutboxScheduler = Readonly<Pick<TriggerContext["scheduler"], "runJob">>;

/** What the queue itself needs: enough to forget deleted content, which takes no webhook. */
export type QueueDependencies = Readonly<{ redis: OutboxRedis; scheduler: OutboxScheduler }>;

export type OutboxDependencies = QueueDependencies &
    Readonly<{
        /** An https URL. */
        webhookUrl: string;
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

/** Takes the lease that lets one drain, or one rewrite of the queue, work on it at a time; false when it is held. */
async function lease({ redis }: QueueDependencies): Promise<boolean> {
    return (
        (await redis.set(LEASE_KEY, String(Date.now()), {
            nx: true,
            expiration: new Date(Date.now() + LEASE_MS),
        })) !== ""
    );
}

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

/**
 * What to send for a queued message: undefined for one unreadable or queued over a day ago, and its version without
 * quotes once content it quotes is deleted, which may happen while it waits, even while this drain is under way.
 */
async function messageToSend({ redis }: OutboxDependencies, queued: Queued): Promise<SlackMessage | undefined> {
    if (queued.message === undefined || Date.now() - queued.queuedAt > MAX_AGE_SECONDS * MS_PER_SECOND) {
        return undefined;
    }
    return queued.quoting !== undefined && (await anyDeleted(redis, queued.quoting.contentIds))
        ? queued.quoting.withoutQuotes
        : queued.message;
}

/** One message's delivery within a drain, logging what Slack would not take. */
async function deliver(drain: Drain, message: SlackMessage): Promise<Delivery> {
    const delivery = await deliverWithRetries(drain, message, 0);
    if (delivery.outcome !== "delivered") {
        logFailure(delivery.failure, message);
    }
    return delivery;
}

/** Delivers the oldest message, or drops one too old or unreadable; a DrainEnd when the queue must wait. */
async function deliverNext(drain: Drain, queued: Queued): Promise<DrainEnd | undefined> {
    const message = await messageToSend(drain.outbox, queued);
    if (message === undefined) {
        console.error("Dropped a Slack message that was unreadable or queued over a day ago", {
            queuedAt: new Date(queued.queuedAt).toISOString(),
        });
        await remove(drain.outbox.redis, queued);
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

/** Schedules one drain to continue later; a continuation already scheduled covers this one. */
async function scheduleDrain({ redis, scheduler }: QueueDependencies, afterMs: number): Promise<void> {
    const runAt = new Date(Date.now() + afterMs);
    const claimed =
        (await redis.set(DRAIN_SCHEDULED_KEY, runAt.toISOString(), {
            nx: true,
            expiration: new Date(runAt.getTime() + LEASE_MS),
        })) !== "";
    if (claimed) {
        await scheduler.runJob({ name: OUTBOX_JOB_NAME, runAt });
    }
}

/**
 * Schedules a drain for after the current lease has expired, for when the drain holding it dies first: Devvit ends
 * a handler that runs too long, and a Slack request can take up to the fetch timeout. Without it, what that drain
 * left queued would wait for the next alert. A recovery already scheduled covers this one; it expires as its drain
 * runs, so a drain that finds the lease held can schedule the next.
 */
async function scheduleRecovery({ redis, scheduler }: OutboxDependencies): Promise<void> {
    const runAt = new Date(Date.now() + LEASE_MS + MS_PER_SECOND);
    const claimed =
        (await redis.set(RECOVERY_SCHEDULED_KEY, runAt.toISOString(), { nx: true, expiration: runAt })) !== "";
    if (claimed) {
        await scheduler.runJob({ name: OUTBOX_JOB_NAME, runAt });
    }
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
        await outbox.redis.del(LEASE_KEY);
    }
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
                await enqueueQuoting(outbox.redis, message, quoting);
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
            await outbox.redis.del(DRAIN_SCHEDULED_KEY);
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
        await queue.redis.del(LEASE_KEY);
    }
    // A message queued while this held the lease left itself to a drain, as to one under way: a drain follows.
    if ((await oldest(queue.redis)) !== undefined) {
        await scheduleDrain(queue, CONTINUE_SOON_MS);
    }
}
