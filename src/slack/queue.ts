import type { TriggerContext } from "@devvit/public-api";
import type { Quoting, SlackMessage } from "./message.js";

/** The outbox's two queues: the Alert Channel's, delivered first, and the Notification Channel's. */
export type QueueName = "alerts" | "notifications";

/**
 * Each queue: a sorted set of messages, each scored by when it was queued. Installations already hold members in
 * `slack_outbox`, which was the only queue before the alert queue, and is now the notification queue.
 */
export const QUEUE_KEYS: Readonly<Record<QueueName, string>> = {
    alerts: "slack_outbox_alerts",
    notifications: "slack_outbox",
};
const QUEUE_NAMES: readonly QueueName[] = ["alerts", "notifications"];
/** A message queued longer than this is dropped: it is no longer news. A day. */
export const MAX_AGE_SECONDS = 86_400;
/** At most this many messages wait in each queue; beyond that, the queue's oldest are dropped. */
const MAX_QUEUED = 500;

export type QueueRedis = Readonly<
    Pick<TriggerContext["redis"], "expire" | "zAdd" | "zRange" | "zRem" | "zRemRangeByRank">
>;

/** A queued message, as stored; `message` is undefined for a member this app cannot read. */
export interface Queued {
    /** The queue it waits in. */
    readonly queue: QueueName;
    readonly member: string;
    readonly score: number;
    readonly id: string;
    readonly queuedAt: number;
    readonly message: SlackMessage | undefined;
    /** What the message quotes from Reddit, when it quotes anything. */
    readonly quoting: Quoting | undefined;
}

/** A queued message that quotes Reddit content. */
export type QueuedQuoting = Queued & Readonly<{ quoting: Quoting }>;

/** How many messages wait in a queue, and when its oldest was queued, in ms since the epoch. */
export type QueueState = Readonly<{ waiting: number; oldestQueuedAt: number | undefined }>;

/** A stored member's fields; none for one this app cannot read. */
function fieldsOf(member: string): ReadonlyMap<string, unknown> {
    try {
        const stored: unknown = JSON.parse(member);
        return new Map(typeof stored === "object" && stored !== null ? Object.entries(stored) : []);
    } catch {
        // Not JSON: not a member this app wrote.
        return new Map();
    }
}

/** Whether a stored value is a message. The app writes these members itself, so their text is the check. */
export function isSlackMessage(value: unknown): value is SlackMessage {
    return typeof value === "object" && value !== null && "text" in value && typeof value.text === "string";
}

function texts(value: unknown): readonly string[] {
    return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === "string") : [];
}

/** What a stored member says it quotes: it quotes something when it holds a version without the quotes. */
function quotingOf(fields: Readonly<Pick<ReadonlyMap<string, unknown>, "get">>): Quoting | undefined {
    const withoutQuotes = fields.get("withoutQuotes");
    return isSlackMessage(withoutQuotes) ? { contentIds: texts(fields.get("contentIds")), withoutQuotes } : undefined;
}

function queuedOf(queue: QueueName, { member, score }: Readonly<{ member: string; score: number }>): Queued {
    const fields = fieldsOf(member);
    const [id, queuedAt, message] = ["id", "queuedAt", "message"].map((name: string): unknown => fields.get(name));
    return {
        queue,
        member,
        score,
        id: typeof id === "string" ? id : "",
        queuedAt: typeof queuedAt === "number" ? queuedAt : 0,
        message: isSlackMessage(message) ? message : undefined,
        quoting: quotingOf(fields),
    };
}

type Stamp = Readonly<{ id: string; queuedAt: number }>;

/** How a message is stored: with what it quotes, and its version without that, when it quotes anything. */
function memberOf({ id, queuedAt }: Stamp, message: SlackMessage, quoting: Quoting | undefined): string {
    return JSON.stringify(
        quoting === undefined
            ? { id, queuedAt, message }
            : { id, queuedAt, message, contentIds: quoting.contentIds, withoutQuotes: quoting.withoutQuotes },
    );
}

/** A message on its way to a queue: the queue, the message, and what it quotes when it quotes anything. */
export type Outgoing = Readonly<{ queue: QueueName; message: SlackMessage; quoting: Quoting | undefined }>;

/** What each queue is called when moderators are told about it. */
export const QUEUE_TITLES: Readonly<Record<QueueName, string>> = {
    alerts: "alert queue",
    notifications: "notification queue",
};

/** Queues the message in its queue, and returns how many of that queue's oldest messages it pushed out. */
export async function enqueue(redis: QueueRedis, { queue, message, quoting }: Outgoing): Promise<number> {
    const key = QUEUE_KEYS[queue];
    const queuedAt = Date.now();
    const member = memberOf({ id: `${String(queuedAt)}:${String(Math.random())}`, queuedAt }, message, quoting);
    await redis.zAdd(key, { member, score: queuedAt });
    await redis.expire(key, MAX_AGE_SECONDS);
    return await redis.zRemRangeByRank(key, 0, -(MAX_QUEUED + 1));
}

/** How many messages wait in each queue, and when each queue's oldest was queued. */
export async function queueState(
    redis: Readonly<Pick<QueueRedis, "zRange">> & Readonly<Pick<TriggerContext["redis"], "zCard">>,
): Promise<Readonly<Record<QueueName, QueueState>>> {
    const stateOf = async (queue: QueueName): Promise<QueueState> => {
        const key = QUEUE_KEYS[queue];
        const waiting = await redis.zCard(key);
        const [first] = await redis.zRange(key, 0, 0, { by: "rank" });
        return { waiting, oldestQueuedAt: first?.score };
    };
    return { alerts: await stateOf("alerts"), notifications: await stateOf("notifications") };
}

/** The next message to deliver: the oldest alert, else the oldest notification; undefined when none waits. */
export async function oldest(redis: QueueRedis): Promise<Queued | undefined> {
    const [alert] = await redis.zRange(QUEUE_KEYS.alerts, 0, 0, { by: "rank" });
    if (alert !== undefined) {
        return queuedOf("alerts", alert);
    }
    const [notification] = await redis.zRange(QUEUE_KEYS.notifications, 0, 0, { by: "rank" });
    return notification === undefined ? undefined : queuedOf("notifications", notification);
}

/** The queued messages, in both queues, that quote Reddit content. */
export async function quotingMessages(redis: QueueRedis): Promise<readonly QueuedQuoting[]> {
    const queues = await Promise.all(
        QUEUE_NAMES.map(async (queue: QueueName): Promise<readonly Queued[]> => {
            const members = await redis.zRange(QUEUE_KEYS[queue], 0, -1, { by: "rank" });
            return members.map((member: Readonly<{ member: string; score: number }>): Queued =>
                queuedOf(queue, member),
            );
        }),
    );
    return queues.flat().filter((queued: Queued): queued is QueuedQuoting => queued.quoting !== undefined);
}

export async function remove(redis: QueueRedis, queued: Queued): Promise<void> {
    await redis.zRem(QUEUE_KEYS[queued.queue], [queued.member]);
}

/**
 * Puts the message's version without quotes in its place, keeping its queue and its place in it, so the text it
 * quoted is no longer stored. One that has already left the queue stays gone.
 */
export async function replaceWithoutQuotes(redis: QueueRedis, queued: QueuedQuoting): Promise<void> {
    const key = QUEUE_KEYS[queued.queue];
    if ((await redis.zRem(key, [queued.member])) === 0) {
        return;
    }
    await redis.zAdd(key, { member: memberOf(queued, queued.quoting.withoutQuotes, undefined), score: queued.score });
}
