import type { TriggerContext } from "@devvit/public-api";
import type { Quoting, SlackMessage } from "./message.js";
import { isSlackMessage } from "./queue.js";
import type { Posted } from "./webApi.js";

/**
 * Where Slack holds the alerts that quote each post and comment, so that if Reddit deletes it the app can take it
 * out of them: for each post or comment, a hash of its alerts by channel and timestamp, each with the alert's
 * version without quotes. Holds what that version says, as Slack shows it, and no quoted content.
 */
const SENT_PREFIX = "slack_outbox_sent:";
/** The posts and comments remembered, each by when an alert last quoted it, so the oldest can be forgotten. */
const REMEMBERED_KEY = "slack_outbox_sent";
/**
 * How long after an alert is sent its quotes can still be taken out: 90 days, the shortest message retention Slack
 * offers every workspace, so a workspace that keeps messages that long holds none the app has forgotten.
 */
const SENT_KEPT_SECONDS = 7_776_000;
/**
 * At most this many posts and comments are remembered; past it, the oldest are forgotten first. At under a kilobyte
 * an alert, this keeps the records well inside the 100 MB of Redis an installation of an unpublished app has.
 */
const MAX_REMEMBERED = 50_000;
const MS_PER_SECOND = 1000;

export type SentRedis = Readonly<
    Pick<
        TriggerContext["redis"],
        "del" | "expire" | "hGetAll" | "hSet" | "zAdd" | "zRange" | "zRem" | "zRemRangeByScore"
    >
>;

/** An alert in Slack that quotes Reddit content: where it is, and its version without the quotes. */
export type SentAlert = Readonly<{ posted: Posted; withoutQuotes: SlackMessage }>;

function sentKey(contentId: string): string {
    return `${SENT_PREFIX}${contentId}`;
}

/** A field naming a message: its channel and timestamp, neither of which holds a space. */
function fieldOf({ channel, ts }: Posted): string {
    return `${channel} ${ts}`;
}

/** Forgets the posts and comments past the time kept, and the oldest past the limit, with their alerts. */
async function forgetOldest(redis: SentRedis, now: number): Promise<void> {
    // Their hashes expire by themselves.
    await redis.zRemRangeByScore(REMEMBERED_KEY, Number.NEGATIVE_INFINITY, now - SENT_KEPT_SECONDS * MS_PER_SECOND);
    const overflow = (await redis.zRange(REMEMBERED_KEY, 0, -(MAX_REMEMBERED + 1), { by: "rank" })).map(
        ({ member }: Readonly<{ member: string }>): string => member,
    );
    if (overflow.length === 0) {
        return;
    }
    await redis.del(...overflow.map(sentKey));
    await redis.zRem(REMEMBERED_KEY, overflow);
}

/** Remembers where Slack put an alert that quotes Reddit content, under each post and comment it quotes. */
export async function rememberSent(redis: SentRedis, posted: Posted, quoting: Quoting): Promise<void> {
    const now = Date.now();
    const withoutQuotes = JSON.stringify(quoting.withoutQuotes);
    await Promise.all(
        quoting.contentIds.map(async (contentId: string): Promise<void> => {
            await redis.hSet(sentKey(contentId), { [fieldOf(posted)]: withoutQuotes });
            await redis.expire(sentKey(contentId), SENT_KEPT_SECONDS);
            await redis.zAdd(REMEMBERED_KEY, { member: contentId, score: now });
        }),
    );
    await redis.expire(REMEMBERED_KEY, SENT_KEPT_SECONDS);
    await forgetOldest(redis, now);
}

function sentAlertOf(field: string, value: string): SentAlert[] {
    const [channel = "", ts = ""] = field.split(" ");
    try {
        const withoutQuotes: unknown = JSON.parse(value);
        return channel !== "" && ts !== "" && isSlackMessage(withoutQuotes)
            ? [{ posted: { channel, ts }, withoutQuotes }]
            : [];
    } catch {
        // Not JSON: not a record this app wrote.
        return [];
    }
}

/** Takes the alerts that quote this post or comment out of what is remembered, and returns them. */
export async function takeSent(redis: SentRedis, contentId: string): Promise<readonly SentAlert[]> {
    const fields = await redis.hGetAll(sentKey(contentId));
    if (Object.keys(fields).length === 0) {
        return [];
    }
    await redis.del(sentKey(contentId));
    await redis.zRem(REMEMBERED_KEY, [contentId]);
    return Object.entries(fields).flatMap(([field, value]: readonly [string, string]): SentAlert[] =>
        sentAlertOf(field, value),
    );
}
