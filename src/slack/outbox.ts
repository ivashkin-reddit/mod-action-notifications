import { anyDeleted, enqueueQuoting, noteDeleted, queueQuotes, removeDeletedQuotes } from "./deletions.js";
import { callWithRetries, waitAfter, whenLastSent } from "./drain.js";
import type { Drain, DrainEnd, OutboxDependencies, QueueDependencies } from "./drain.js";
import { reportDelivery } from "./health.js";
import type { Quoting, SlackMessage, SlackSender } from "./message.js";
import { MAX_AGE_SECONDS, oldest, QUEUE_TITLES, remove } from "./queue.js";
import type { Queued, QueueName } from "./queue.js";
import { oldestRedaction, queueRedactions, redactNext } from "./redactions.js";
import { endsRefusal } from "./refusals.js";
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
import { rememberSent, takeSent } from "./sent.js";
import type { SentAlert } from "./sent.js";
import { createDirectSender, postMessage, wait } from "./webApi.js";
import type { Delivery, Posted } from "./webApi.js";

const MS_PER_SECOND = 1000;

/**
 * Each sender queues the message, then delivers what is queued at Slack's pace: every alert, oldest first, then
 * every notification, oldest first. It sends the message directly when the queue cannot be written, and queues a
 * message quoting content already deleted without the quotes. Neither rejects.
 */
export interface SlackOutbox {
    /** Queues the message in the alert queue, delivered before any notification waiting with it. */
    readonly alerts: SlackSender;
    /** Queues the message in the notification queue. */
    readonly notifications: SlackSender;
    /** Delivers what is queued, as the scheduled job. Rejects when the queue cannot be read. */
    readonly deliverQueued: () => Promise<void>;
}

/** Why a queued message is dropped unsent: it cannot be read, or it was queued over a day ago. */
type DropReason = "unreadable" | "expired";

/** What to post for a queued message: the message, and what it quotes when it goes with its quotes. */
type ToSend = Readonly<{ message: SlackMessage; quoting: Quoting | undefined }>;

/**
 * What to send for a queued message, or why to drop it; its version without quotes once content it quotes is
 * deleted, which may happen while it waits, even while this drain is under way.
 */
async function messageToSend({ redis }: OutboxDependencies, queued: Queued): Promise<ToSend | DropReason> {
    if (queued.message === undefined) {
        return "unreadable";
    }
    if (Date.now() - queued.queuedAt > MAX_AGE_SECONDS * MS_PER_SECOND) {
        return "expired";
    }
    return queued.quoting !== undefined && (await anyDeleted(redis, queued.quoting.contentIds))
        ? { message: queued.quoting.withoutQuotes, quoting: undefined }
        : { message: queued.message, quoting: queued.quoting };
}

/**
 * Drops a queued message unsent. Alerts dropped for their age are a condition, which lasts while Slack does not take
 * them; one that cannot be read is left by another version of the app, and logged.
 */
async function drop({ outbox }: Drain, queued: Queued, reason: DropReason): Promise<void> {
    await outbox.health.note("alert-dropped", 1);
    if (reason === "expired") {
        await outbox.health.raise("alerts-expired", "");
    } else {
        console.warn("[outbox] Dropped a queued alert it could not read");
    }
    await remove(outbox.redis, queued);
}

/**
 * Remembers where Slack put an alert it took with quotes of Reddit content, so a later deletion of that content can
 * take it out. Content deleted while the alert was on its way found nothing to take it out of, so the alert is
 * redacted at once. When Redis cannot remember it, the alert keeps its quotes, and that is reported. An alert
 * without quotes, or one whose place Slack did not say, is not remembered.
 */
async function rememberQuoting(
    { outbox }: Drain,
    delivery: Delivery<Posted>,
    quoting: Quoting | undefined,
): Promise<void> {
    if (delivery.outcome !== "delivered" || quoting === undefined || delivery.answer.ts === "") {
        return;
    }
    const posted = delivery.answer;
    try {
        await rememberSent(outbox, posted, quoting);
        if (await anyDeleted(outbox.redis, quoting.contentIds)) {
            await queueRedactions(outbox.redis, [{ posted, withoutQuotes: quoting.withoutQuotes }]);
        }
    } catch (error) {
        await outbox.health.raise(
            "redactions-failing",
            `could not remember where an alert went: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}

/** Posts a message within a drain, reporting what Slack's answer says about Slack. */
async function post(drain: Drain, message: SlackMessage): Promise<Delivery<Posted>> {
    const { health, redis, api } = drain.outbox;
    const delivery = await callWithRetries(
        drain,
        async (): Promise<Delivery<Posted>> => await postMessage(api, message),
    );
    await reportDelivery(health, delivery, await endsRefusal(redis, delivery, message.channel ?? ""));
    return delivery;
}

/** Delivers the oldest message, or drops one too old or unreadable; a DrainEnd when the queue must wait. */
async function deliverNext(drain: Drain, queued: Queued): Promise<DrainEnd | undefined> {
    const toSend = await messageToSend(drain.outbox, queued);
    if (typeof toSend === "string") {
        await drop(drain, queued, toSend);
        return undefined;
    }
    const delivery = await post(drain, toSend.message);
    if (delivery.outcome === "retry") {
        return waitAfter(delivery.retryAfterMs);
    }
    await remove(drain.outbox.redis, queued);
    await rememberQuoting(drain, delivery, toSend.quoting);
    return undefined;
}

/** What a drain does next: deliver the oldest alert, else make the oldest redaction; undefined when none waits. */
async function nextWork(drain: Drain): Promise<(() => Promise<DrainEnd | undefined>) | undefined> {
    const queued = await oldest(drain.outbox.redis);
    if (queued !== undefined) {
        return async (): Promise<DrainEnd | undefined> => await deliverNext(drain, queued);
    }
    const redaction = await oldestRedaction(drain.outbox.redis);
    return redaction === undefined
        ? undefined
        : async (): Promise<DrainEnd | undefined> => await redactNext(drain, redaction);
}

/** Waits until `SEND_INTERVAL_MS` after the last call to Slack. */
async function keepPace(lastSentAt: number): Promise<void> {
    const pause = lastSentAt + SEND_INTERVAL_MS - Date.now();
    if (pause > 0) {
        await wait(pause);
    }
}

/**
 * Delivers queued messages one at a time, `SEND_INTERVAL_MS` apart, then makes waiting redactions at the same pace,
 * until nothing is left or what is left must wait. Alerts go first: they are news, and a redaction can wait.
 */
async function drainQueue(drain: Drain, lastSentAt: number): Promise<DrainEnd> {
    if (Date.now() >= drain.deadline) {
        return { until: "later", afterMs: CONTINUE_SOON_MS };
    }
    const work = await nextWork(drain);
    if (work === undefined) {
        return { until: "empty" };
    }
    await keepPace(lastSentAt);
    return (await work()) ?? (await drainQueue(drain, Date.now()));
}

/** Whether alerts or redactions wait. */
async function anyWaiting({ redis }: QueueDependencies): Promise<boolean> {
    return (await oldest(redis)) !== undefined || (await oldestRedaction(redis)) !== undefined;
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
        if (await anyWaiting(outbox)) {
            // The recovery only covers this drain dying: one the scheduler refuses must not stop the delivery.
            await scheduleRecovery(outbox).catch((error: unknown): void => {
                console.warn("[outbox] Could not schedule a recovery drain, so delivering without one:", error);
            });
        }
        const end = await drainQueue({ outbox, deadline: Date.now() + DRAIN_BUDGET_MS }, await whenLastSent(outbox));
        await removeDeletedQuotes(outbox.redis);
        return end;
    } finally {
        await releaseLease(outbox);
    }
}

/** A drain emptied the queue, which is then neither full nor holding alerts a day old. */
async function queueEmptied({ health }: OutboxDependencies): Promise<void> {
    await health.clear("outbox-full");
    await health.clear("alerts-expired");
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
    if (await anyWaiting(outbox)) {
        await scheduleDrain(outbox, CONTINUE_SOON_MS);
    }
}

/**
 * Alerts as a queue in Redis, delivered oldest first at the pace Slack takes them, so a burst of mod actions is
 * delivered in full rather than rate-limited away. One drain delivers at a time (a lease); what it cannot deliver in
 * its time, or while Slack is failing, waits for a scheduled later drain, and what a drain that dies leaves waits for
 * a recovery drain after its lease expires. A message is delivered at least once: a request Slack took but whose
 * answer was lost, or that a dying drain made, is sent again. Content deleted on Reddit leaves the queue's messages,
 * and is taken out of the alerts already in Slack that quote it.
 */
/** A sender that queues each message in `queue`, then delivers what is queued. */
function queueAndDeliver(outbox: OutboxDependencies, queue: QueueName): SlackSender {
    return async (message: SlackMessage, quoting?: Quoting): Promise<void> => {
        try {
            const dropped = await enqueueQuoting(outbox.redis, { queue, message, quoting });
            if (dropped > 0) {
                await outbox.health.note("alert-dropped", dropped);
                await outbox.health.raise("outbox-full", QUEUE_TITLES[queue]);
            }
        } catch (error) {
            // The queue only paces delivery: without it, the alert still goes, straight to Slack, which logs a
            // failure itself. Sent so, it is not remembered, and keeps its quotes if its content is deleted.
            console.warn("[outbox] Could not queue an alert, so sent it straight to Slack:", error);
            await createDirectSender(outbox.api)(message);
            return;
        }
        await deliverQueued(outbox).catch((error: unknown): void => {
            // The message stays queued for the next drain.
            console.error("[outbox] Could not deliver the queued alerts; they wait for the next drain:", error);
        });
    };
}

export function createSlackOutbox(outbox: OutboxDependencies): SlackOutbox {
    return {
        alerts: queueAndDeliver(outbox, "alerts"),
        notifications: queueAndDeliver(outbox, "notifications"),
        deliverQueued: async (): Promise<void> => {
            await continuationStarted(outbox);
            await deliverQueued(outbox);
        },
    };
}

/** Queues a redaction of each alert in Slack that quotes the content, and has a drain make them. */
async function redactSent(queue: QueueDependencies, contentId: string): Promise<void> {
    // Each page is queued before it is forgotten: a deletion that fails between the two is handled again, not lost.
    const found = await takeSent(queue.redis, contentId, async (alerts: readonly SentAlert[]): Promise<void> => {
        if ((await queueRedactions(queue.redis, alerts)) > 0) {
            await queue.health.raise("redactions-failing", "too many waiting");
        }
    });
    if (found) {
        await scheduleDrain(queue, CONTINUE_SOON_MS);
    }
}

/**
 * Notes that Reddit deleted this post or comment, by its ID: from now on, each message quoting it is sent and stored
 * without the quotes, and the alerts in Slack that quote it are edited to go without them. Those queued lose them
 * now, unless a drain holds the queue: it takes them out before it lets go. Needs no bot token, as messages and
 * edits wait in the queue while none is set. Rejects when Redis fails.
 */
export async function forgetContent(queue: QueueDependencies, contentId: string): Promise<void> {
    await noteDeleted(queue.redis, contentId);
    await redactSent(queue, contentId);
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
