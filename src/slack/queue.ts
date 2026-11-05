import type { TriggerContext } from "@devvit/public-api";
import type { Quoting, SlackMessage } from "./message.js";

/** The queue: a sorted set of messages, each scored by when it was queued. Installations already hold members in it. */
export const QUEUE_KEY = "slack_outbox";
/** A message queued longer than this is dropped: it is no longer news. A day. */
export const MAX_AGE_SECONDS = 86_400;
/** At most this many messages wait; beyond that the oldest are dropped. */
const MAX_QUEUED = 500;

export type QueueRedis = Readonly<
    Pick<TriggerContext["redis"], "expire" | "zAdd" | "zRange" | "zRem" | "zRemRangeByRank">
>;

/** A queued message, as stored; `message` is undefined for a member this app cannot read. */
export interface Queued {
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
function isSlackMessage(value: unknown): value is SlackMessage {
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

function queuedOf({ member, score }: Readonly<{ member: string; score: number }>): Queued {
    const fields = fieldsOf(member);
    const [id, queuedAt, message] = ["id", "queuedAt", "message"].map((name: string): unknown => fields.get(name));
    return {
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

/** Queues the message, and returns how many of the oldest messages it pushed out of a full queue. */
export async function enqueue(redis: QueueRedis, message: SlackMessage, quoting: Quoting | undefined): Promise<number> {
    const queuedAt = Date.now();
    const member = memberOf({ id: `${String(queuedAt)}:${String(Math.random())}`, queuedAt }, message, quoting);
    await redis.zAdd(QUEUE_KEY, { member, score: queuedAt });
    await redis.expire(QUEUE_KEY, MAX_AGE_SECONDS);
    return await redis.zRemRangeByRank(QUEUE_KEY, 0, -(MAX_QUEUED + 1));
}

export async function oldest(redis: QueueRedis): Promise<Queued | undefined> {
    const [first] = await redis.zRange(QUEUE_KEY, 0, 0, { by: "rank" });
    return first === undefined ? undefined : queuedOf(first);
}

/** The queued messages that quote Reddit content. */
export async function quotingMessages(redis: QueueRedis): Promise<readonly QueuedQuoting[]> {
    const members = await redis.zRange(QUEUE_KEY, 0, -1, { by: "rank" });
    return members.map(queuedOf).filter((queued: Queued): queued is QueuedQuoting => queued.quoting !== undefined);
}

export async function remove(redis: QueueRedis, queued: Queued): Promise<void> {
    await redis.zRem(QUEUE_KEY, [queued.member]);
}

/**
 * Puts the message's version without quotes in its place, keeping its place in the queue, so the text it quoted is
 * no longer stored. One that has already left the queue stays gone.
 */
export async function replaceWithoutQuotes(redis: QueueRedis, queued: QueuedQuoting): Promise<void> {
    if ((await redis.zRem(QUEUE_KEY, [queued.member])) === 0) {
        return;
    }
    await redis.zAdd(QUEUE_KEY, {
        member: memberOf(queued, queued.quoting.withoutQuotes, undefined),
        score: queued.score,
    });
}
