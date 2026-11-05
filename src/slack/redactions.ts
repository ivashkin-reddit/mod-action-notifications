import type { TriggerContext } from "@devvit/public-api";
import { callWithRetries, waitAfter } from "./drain.js";
import type { Drain, DrainEnd } from "./drain.js";
import type { DeliveryHealth } from "./health.js";
import { isSlackMessage } from "./queue.js";
import type { SentAlert } from "./sent.js";
import { deleteMessage, failureDetail, updateMessage } from "./webApi.js";
import type { Delivery } from "./webApi.js";

/**
 * Redactions: edits that take the content of a post or comment deleted on Reddit out of an alert already in Slack,
 * putting the alert's version without quotes in its place. They wait in their own queue, a sorted set scored by
 * when each was queued, and a drain makes them once no alert is waiting, at the same pace.
 */
const REDACTIONS_KEY = "slack_outbox_redactions";
/** A redaction still waiting after this long is dropped: a week, for Slack to come back. */
const MAX_AGE_SECONDS = 604_800;
/** At most this many redactions wait; beyond that the oldest are dropped. */
const MAX_QUEUED = 5000;
const MS_PER_SECOND = 1000;

/**
 * Error codes with which Slack refuses to edit a message it would still let the app delete: the workspace's
 * settings close messages to editing after a time, or the message cannot be edited (docs.slack.dev, chat.update).
 */
const CANNOT_EDIT: readonly string[] = ["edit_window_closed", "cant_update_message"];
/** Slack holds no such message: someone deleted it in Slack, so nothing is left to redact. */
const MESSAGE_GONE = "message_not_found";

export type RedactionRedis = Readonly<
    Pick<TriggerContext["redis"], "expire" | "zAdd" | "zRange" | "zRem" | "zRemRangeByRank">
>;

/** A queued redaction, as stored; `sent` is undefined for a member this app cannot read. */
export type QueuedRedaction = Readonly<{ member: string; queuedAt: number; sent: SentAlert | undefined }>;

/** Queues a redaction of each alert, and returns how many of the oldest it pushed out of a full queue. */
export async function queueRedactions(redis: RedactionRedis, alerts: readonly SentAlert[]): Promise<number> {
    if (alerts.length === 0) {
        return 0;
    }
    const queuedAt = Date.now();
    await redis.zAdd(
        REDACTIONS_KEY,
        ...alerts.map(({ posted, withoutQuotes }: SentAlert): Readonly<{ member: string; score: number }> => ({
            member: JSON.stringify({ channel: posted.channel, ts: posted.ts, withoutQuotes, queuedAt }),
            score: queuedAt,
        })),
    );
    await redis.expire(REDACTIONS_KEY, MAX_AGE_SECONDS);
    return await redis.zRemRangeByRank(REDACTIONS_KEY, 0, -(MAX_QUEUED + 1));
}

function sentOf(stored: Readonly<Record<string, unknown>>): SentAlert | undefined {
    const { channel, ts, withoutQuotes } = stored;
    return typeof channel === "string" && typeof ts === "string" && isSlackMessage(withoutQuotes)
        ? { posted: { channel, ts }, withoutQuotes }
        : undefined;
}

function queuedOf({ member, score }: Readonly<{ member: string; score: number }>): QueuedRedaction {
    try {
        const stored: unknown = JSON.parse(member);
        return typeof stored === "object" && stored !== null
            ? { member, queuedAt: score, sent: sentOf(Object.fromEntries(Object.entries(stored))) }
            : { member, queuedAt: score, sent: undefined };
    } catch {
        // Not JSON: not a member this app wrote.
        return { member, queuedAt: score, sent: undefined };
    }
}

/** The oldest redaction waiting, if any. */
export async function oldestRedaction(redis: RedactionRedis): Promise<QueuedRedaction | undefined> {
    const [first] = await redis.zRange(REDACTIONS_KEY, 0, 0, { by: "rank" });
    return first === undefined ? undefined : queuedOf(first);
}

/** Reports what a redaction's last call says: done, refused, or waiting for Slack to take calls again. */
async function reportRedaction(health: DeliveryHealth, delivery: Delivery<unknown>): Promise<void> {
    if (
        delivery.outcome === "delivered" ||
        (delivery.failure.kind === "response" && delivery.failure.error === MESSAGE_GONE)
    ) {
        await health.note("alert-redacted", 1);
        await health.clear("redactions-failing");
        await health.clear("slack-unreachable");
        return;
    }
    await health.raise(
        delivery.outcome === "rejected" ? "redactions-failing" : "slack-unreachable",
        failureDetail(delivery.failure),
    );
}

/** Edits the alert to its version without quotes, or deletes it where Slack lets the app delete it but not edit it. */
async function redact(drain: Drain, { posted, withoutQuotes }: SentAlert): Promise<Delivery> {
    const { token } = drain.outbox;
    const edit = await callWithRetries(
        drain,
        async (): Promise<Delivery> => await updateMessage(token, posted, withoutQuotes),
    );
    return edit.outcome === "rejected" && edit.failure.kind === "response" && CANNOT_EDIT.includes(edit.failure.error)
        ? await callWithRetries(drain, async (): Promise<Delivery> => await deleteMessage(token, posted))
        : edit;
}

/** Why a waiting redaction is dropped unmade: it cannot be read, or it waited a week; undefined to make it. */
function whyDrop(queued: QueuedRedaction): string | undefined {
    if (queued.sent === undefined) {
        return "unreadable";
    }
    return Date.now() - queued.queuedAt > MAX_AGE_SECONDS * MS_PER_SECOND ? "waited a week" : undefined;
}

/**
 * Makes the oldest redaction, or drops one too old or unreadable; a DrainEnd when the queue must wait. A redaction
 * Slack refuses is dropped, and reported: the alert keeps its quotes until someone deletes it in Slack.
 */
export async function redactNext(drain: Drain, queued: QueuedRedaction): Promise<DrainEnd | undefined> {
    const { health, redis } = drain.outbox;
    const why = whyDrop(queued);
    if (why !== undefined) {
        await health.raise("redactions-failing", why);
    } else if (queued.sent !== undefined) {
        const delivery = await redact(drain, queued.sent);
        await reportRedaction(health, delivery);
        if (delivery.outcome === "retry") {
            return waitAfter(delivery.retryAfterMs);
        }
    }
    await redis.zRem(REDACTIONS_KEY, [queued.member]);
    return undefined;
}
