import type { TriggerContext } from "@devvit/public-api";
import type { DeletionRedis } from "./deletions.js";
import type { DeliveryHealth } from "./health.js";
import type { SentRedis } from "./sent.js";
import { backoffMs, wait } from "./webApi.js";
import type { SlackApi, Delivery } from "./webApi.js";

/**
 * What one drain of the outbox shares between the alerts it posts and the edits it makes: what it works with, its
 * deadline, the pace it keeps, and retries.
 */

type OutboxRedis = DeletionRedis & SentRedis & Readonly<Pick<TriggerContext["redis"], "get" | "set" | "del">>;
type OutboxScheduler = Readonly<Pick<TriggerContext["scheduler"], "runJob">>;

/** What the queue itself needs: enough to forget deleted content, which takes no bot token. */
export type QueueDependencies = Readonly<{
    redis: OutboxRedis;
    scheduler: OutboxScheduler;
    /** Where lasting delivery problems are reported. */
    health: DeliveryHealth;
}>;

export type OutboxDependencies = QueueDependencies &
    Readonly<{
        /** How Slack is called: the Slack app's bot token, and the fetch that carries it. */
        api: SlackApi;
        /** How many days the alert channels keep messages: how long the app remembers where each alert is. */
        retentionDays: number;
    }>;

/** One drain: what it works with, and when it stops starting calls to Slack, in ms since the epoch. */
export type Drain = Readonly<{ outbox: OutboxDependencies; deadline: number }>;

/** Why a drain stopped: nothing is left, or what is left waits `afterMs` for a later drain. */
export type DrainEnd = Readonly<{ until: "empty" }> | Readonly<{ until: "later"; afterMs: number }>;

// The drain's bookkeeping, which expires.
/**
 * When a drain last called Slack, in ms since the epoch: the next drain keeps the pace from it, as each alert that
 * arrives after a drain has finished starts a drain of its own.
 */
const LAST_SENT_KEY = "slack_outbox_last_sent";
/** Long enough to outlast the pause between two calls. */
const LAST_SENT_MEMORY_MS = 60_000;
/** Within one drain, a call is retried this many times before the queue waits for a later drain. */
const MAX_RETRIES_PER_DRAIN = 3;
/** A later drain runs this long after Slack failed to take a call, unless Slack said when to retry. */
const RETRY_LATER_MS = 30_000;

/** When a drain last called Slack; 0 when none has lately. */
export async function whenLastSent({ redis }: OutboxDependencies): Promise<number> {
    const at = Number(await redis.get(LAST_SENT_KEY));
    return Number.isFinite(at) ? at : 0;
}

/** Notes that a call went to Slack now. Only the drain holding the lease calls, so drains cannot race on it. */
async function noteSent({ redis }: OutboxDependencies): Promise<void> {
    const now = Date.now();
    await redis.set(LAST_SENT_KEY, String(now), { expiration: new Date(now + LAST_SENT_MEMORY_MS) });
}

/** One call within a drain: retried after rate limiting and failures, while the drain has time. */
export async function callWithRetries<T>(
    drain: Drain,
    call: () => Promise<Delivery<T>>,
    retryCount = 0,
): Promise<Delivery<T>> {
    const delivery = await call();
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
    return await callWithRetries(drain, call, retryCount + 1);
}

/** How long what is left waits after a call Slack did not take: as long as Slack asked, or 30 seconds. */
export function waitAfter(retryAfterMs: number | undefined): DrainEnd {
    return { until: "later", afterMs: retryAfterMs ?? RETRY_LATER_MS };
}
