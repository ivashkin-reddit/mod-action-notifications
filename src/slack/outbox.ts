import type { TriggerContext } from "@devvit/public-api";
import type { SlackMessage, SlackSender } from "./message.js";
import { attemptDelivery, backoffMs, createWebhookSender, logFailure, wait } from "./webhook.js";
import type { Delivery } from "./webhook.js";

/** The scheduler job that delivers what an earlier drain left queued; the composition root registers it. */
export const OUTBOX_JOB_NAME = "slackOutbox";

// The queue, a sorted set of messages scored by when each was queued, and its bookkeeping, each of which expires.
const QUEUE_KEY = "slack_outbox";
const LEASE_KEY = "slack_outbox_lease";
/** Present while a drain is scheduled to continue where one left off. */
const DRAIN_SCHEDULED_KEY = "slack_outbox_drain_scheduled";
/** Present while a drain is scheduled to follow one that may die before it finishes. */
const RECOVERY_SCHEDULED_KEY = "slack_outbox_recovery_scheduled";

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
/** A message queued longer than this is dropped: it is no longer news. A day. */
const MAX_AGE_SECONDS = 86_400;
/** At most this many messages wait; beyond that the oldest are dropped. */
const MAX_QUEUED = 500;
/** Within one drain, a message is retried this many times before the queue waits for a later drain. */
const MAX_RETRIES_PER_DRAIN = 3;
/** A later drain runs this long after Slack failed to take a message, unless Slack said when to retry. */
const RETRY_LATER_MS = 30_000;
/** A later drain runs this soon after one that used up its time with messages left. */
const CONTINUE_SOON_MS = 1000;

type OutboxRedis = Readonly<
    Pick<TriggerContext["redis"], "get" | "set" | "del" | "expire" | "zAdd" | "zRange" | "zRem" | "zRemRangeByRank">
>;
type OutboxScheduler = Readonly<Pick<TriggerContext["scheduler"], "runJob">>;

export type OutboxDependencies = Readonly<{
    /** An https URL. */
    webhookUrl: string;
    redis: OutboxRedis;
    scheduler: OutboxScheduler;
}>;

export interface SlackOutbox {
    /**
     * Queues the message, then delivers the queue, oldest first, at Slack's pace; sends it directly when the queue
     * cannot be written. Never rejects.
     */
    readonly send: SlackSender;
    /** Delivers what is queued, as the scheduled job. Rejects when the queue cannot be read. */
    readonly deliverQueued: () => Promise<void>;
}

/** A queued message, or, for a member this app cannot read, `message` undefined. */
interface Queued {
    readonly member: string;
    readonly queuedAt: number;
    readonly message: SlackMessage | undefined;
}

/** Why a drain stopped: the queue is empty, or what is left waits `afterMs` for a later drain. */
type DrainEnd = Readonly<{ until: "empty" }> | Readonly<{ until: "later"; afterMs: number }>;

type Drain = Readonly<{ outbox: OutboxDependencies; deadline: number }>;

function parsed(json: string): unknown {
    try {
        return JSON.parse(json);
    } catch {
        // Not JSON: not a member this app wrote.
        return undefined;
    }
}

/** Whether a queued value is a message. The app writes these members itself, so their text is the check. */
function isSlackMessage(value: unknown): value is SlackMessage {
    return typeof value === "object" && value !== null && "text" in value && typeof value.text === "string";
}

function queuedOf(member: string): Queued {
    const stored = parsed(member);
    if (typeof stored !== "object" || stored === null || !("queuedAt" in stored) || !("message" in stored)) {
        return { member, queuedAt: 0, message: undefined };
    }
    const { queuedAt, message } = stored;
    return {
        member,
        queuedAt: typeof queuedAt === "number" ? queuedAt : 0,
        message: isSlackMessage(message) ? message : undefined,
    };
}

async function enqueue({ redis }: OutboxDependencies, message: SlackMessage): Promise<void> {
    const queuedAt = Date.now();
    const member = JSON.stringify({ id: `${String(queuedAt)}:${String(Math.random())}`, queuedAt, message });
    await redis.zAdd(QUEUE_KEY, { member, score: queuedAt });
    await redis.expire(QUEUE_KEY, MAX_AGE_SECONDS);
    const dropped = await redis.zRemRangeByRank(QUEUE_KEY, 0, -(MAX_QUEUED + 1));
    if (dropped > 0) {
        console.error("Slack outbox is full: dropped its oldest messages", { dropped });
    }
}

async function oldest({ redis }: OutboxDependencies): Promise<Queued | undefined> {
    const [first] = await redis.zRange(QUEUE_KEY, 0, 0, { by: "rank" });
    return first === undefined ? undefined : queuedOf(first.member);
}

/** One message's delivery within a drain: retried after rate limiting and failures, while the drain has time. */
async function deliverWithRetries(drain: Drain, message: SlackMessage, retryCount: number): Promise<Delivery> {
    const delivery = await attemptDelivery(drain.outbox.webhookUrl, message);
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

async function drop({ redis }: OutboxDependencies, queued: Queued): Promise<void> {
    console.error("Dropped a Slack message that was unreadable or queued over a day ago", {
        queuedAt: new Date(queued.queuedAt).toISOString(),
    });
    await redis.zRem(QUEUE_KEY, [queued.member]);
}

/** Delivers the oldest message, or drops one too old or unreadable; a DrainEnd when the queue must wait. */
async function deliverNext(drain: Drain, queued: Queued): Promise<DrainEnd | undefined> {
    if (queued.message === undefined || Date.now() - queued.queuedAt > MAX_AGE_SECONDS * MS_PER_SECOND) {
        await drop(drain.outbox, queued);
        return undefined;
    }
    const delivery = await deliverWithRetries(drain, queued.message, 0);
    if (delivery.outcome !== "delivered") {
        logFailure(delivery.failure, queued.message);
    }
    if (delivery.outcome === "retry") {
        return { until: "later", afterMs: delivery.retryAfterMs ?? RETRY_LATER_MS };
    }
    await drain.outbox.redis.zRem(QUEUE_KEY, [queued.member]);
    return undefined;
}

/** Delivers queued messages one at a time, `SEND_INTERVAL_MS` apart, until the queue empties or must wait. */
async function drainQueue(drain: Drain, lastSentAt: number): Promise<DrainEnd> {
    if (Date.now() >= drain.deadline) {
        return { until: "later", afterMs: CONTINUE_SOON_MS };
    }
    const queued = await oldest(drain.outbox);
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
async function scheduleDrain({ redis, scheduler }: OutboxDependencies, afterMs: number): Promise<void> {
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

/** Drains the queue while holding the lease; undefined when another drain holds it, and will deliver the queue. */
async function drainUnderLease(outbox: OutboxDependencies): Promise<DrainEnd | undefined> {
    const leased =
        (await outbox.redis.set(LEASE_KEY, String(Date.now()), {
            nx: true,
            expiration: new Date(Date.now() + LEASE_MS),
        })) !== "";
    if (!leased) {
        return undefined;
    }
    try {
        if ((await oldest(outbox)) !== undefined) {
            await scheduleRecovery(outbox);
        }
        return await drainQueue({ outbox, deadline: Date.now() + DRAIN_BUDGET_MS }, 0);
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
    if ((await oldest(outbox)) !== undefined) {
        await scheduleDrain(outbox, CONTINUE_SOON_MS);
    }
}

/**
 * Alerts as a queue in Redis, delivered oldest first at the pace Slack takes them, so a burst of mod actions is
 * delivered in full rather than rate-limited away. One drain delivers at a time (a lease); what it cannot deliver in
 * its time, or while Slack is failing, waits for a scheduled later drain, and what a drain that dies leaves waits for
 * a recovery drain after its lease expires. A message is delivered at least once: a request Slack took but whose
 * answer was lost, or that a dying drain made, is sent again.
 */
export function createSlackOutbox(outbox: OutboxDependencies): SlackOutbox {
    return {
        send: async (message: SlackMessage): Promise<void> => {
            try {
                await enqueue(outbox, message);
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
