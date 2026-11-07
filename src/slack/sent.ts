import type { TriggerContext } from "@devvit/public-api";
import type { Quoting, SlackMessage } from "./message.js";
import { isSlackMessage } from "./queue.js";
import type { Posted } from "./webApi.js";

/**
 * Where Slack holds the alerts that quote each post and comment, so that if Reddit deletes it the app can take it
 * out of them. Each alert is remembered for as many days as the alert channels keep messages from when it was sent:
 * its version without quotes, under its channel and timestamp, which Redis expires then; and an entry for each post
 * and comment it quotes, `{contentId} {channel} {ts}`, in two indexes. One sorts the entries by their text, so that a
 * post's are a range; the other by when each alert was sent, so that they are forgotten in turn. They hold what the
 * version without quotes says, as Slack shows it, and no quoted content.
 */
const ALERT_PREFIX = "slack_outbox_sent_alert:";
/** The entries, all scored 0: Redis then sorts them by their text, and a post or comment's entries are a range. */
const BY_CONTENT_KEY = "slack_outbox_sent_by_content";
/** The entries, each scored by when its alert was sent, in ms since the epoch. */
const BY_TIME_KEY = "slack_outbox_sent_by_time";
/**
 * Where an earlier version remembered them: a hash for each post and comment, of its alerts by channel and timestamp,
 * each with its version without quotes. Read when its post or comment is deleted, until the last has expired, at most
 * 90 days after the upgrade.
 */
const LEGACY_PREFIX = "slack_outbox_sent:";
const SECONDS_PER_DAY = 86_400;
const MS_PER_SECOND = 1000;
/** At most this many entries past the channels' retention are forgotten at a time, to bound the work. */
const FORGET_BATCH = 1000;
/**
 * At most this many entries are kept, the oldest forgotten first. An alert has one for each post and comment it
 * quotes: one or two for a mod action, a few for the modqueue's oldest items. At about a kilobyte an alert, this keeps
 * the records to about 100 MB, inside the 5 GB of Redis Devvit documents for an installation.
 */
const MAX_ENTRIES = 100_000;
/** A post or comment's alerts are read this many at a time, so that each read stays well inside a Redis request. */
const PAGE = 100;

export type SentRedis = Readonly<
    Pick<TriggerContext["redis"], "del" | "expire" | "hDel" | "hScan" | "mGet" | "set" | "zAdd" | "zRange" | "zRem">
>;

/** Where the records are, and how many days the alert channels keep messages: how long each is kept. */
export type SentStore = Readonly<{ redis: SentRedis; retentionDays: number }>;

/** An alert in Slack that quotes Reddit content: where it is, and its version without the quotes. */
export type SentAlert = Readonly<{ posted: Posted; withoutQuotes: SlackMessage }>;

/** Takes the alerts handed over, as redactions to make; rejects when they could not be taken. */
export type SentHandler = (alerts: readonly SentAlert[]) => Promise<void>;

/** A deletion taking a post or comment's alerts: where they are, whose they are, and what takes them. */
type Taking = Readonly<{ redis: SentRedis; contentId: string; handle: SentHandler }>;

type ZMember = Readonly<{ member: string; score: number }>;

/** A message's entry for a post or comment it quotes. Neither the ID, the channel nor the timestamp holds a space. */
function entryOf(contentId: string, { channel, ts }: Posted): string {
    return `${contentId} ${channel} ${ts}`;
}

/** Where the entry's alert is in Slack; undefined for an entry this app did not write. */
function postedOf(entry: string): Posted | undefined {
    const [contentId = "", channel = "", ts = "", ...rest] = entry.split(" ");
    return contentId === "" || channel === "" || ts === "" || rest.length > 0 ? undefined : { channel, ts };
}

function alertKey({ channel, ts }: Posted): string {
    return `${ALERT_PREFIX}${channel}:${ts}`;
}

function membersOf(members: readonly Readonly<{ member: string }>[]): string[] {
    return members.map(({ member }: Readonly<{ member: string }>): string => member);
}

/** Where the entries' alerts are in Slack, each once. */
function postedIn(entries: readonly string[]): Posted[] {
    const posted = new Map<string, Posted>();
    for (const entry of entries) {
        const at = postedOf(entry);
        if (at !== undefined) {
            posted.set(alertKey(at), at);
        }
    }
    return [...posted.values()];
}

/** Forgets the entries; the index by time last, as it lists what is left to forget. */
async function forgetEntries(redis: SentRedis, entries: readonly string[]): Promise<void> {
    await redis.zRem(BY_CONTENT_KEY, [...entries]);
    await redis.zRem(BY_TIME_KEY, [...entries]);
}

/**
 * Forgets, with their alerts, the entries sent before the channels' retention, and the oldest past the limit. A
 * moderator can shorten the retention, so those remembered for longer go too, a batch at a time.
 */
async function forgetOldest(redis: SentRedis, now: number, keptSeconds: number): Promise<void> {
    const expired = await redis.zRange(BY_TIME_KEY, 0, now - keptSeconds * MS_PER_SECOND, {
        by: "score",
        limit: { offset: 0, count: FORGET_BATCH },
    });
    const overflow = await redis.zRange(BY_TIME_KEY, 0, -(MAX_ENTRIES + 1), { by: "rank" });
    const forgotten = [...new Set([...membersOf(expired), ...membersOf(overflow)])];
    if (forgotten.length === 0) {
        return;
    }
    const alertKeys = postedIn(forgotten).map(alertKey);
    if (alertKeys.length > 0) {
        await redis.del(...alertKeys);
    }
    await forgetEntries(redis, forgotten);
}

/** Adds the entries to both indexes, as sent `now`, each index kept as long as its latest entry. */
async function addEntries(
    redis: SentRedis,
    entries: readonly string[],
    { now, keptSeconds }: Readonly<{ now: number; keptSeconds: number }>,
): Promise<void> {
    await redis.zAdd(BY_CONTENT_KEY, ...entries.map((member: string): ZMember => ({ member, score: 0 })));
    await redis.zAdd(BY_TIME_KEY, ...entries.map((member: string): ZMember => ({ member, score: now })));
    await redis.expire(BY_CONTENT_KEY, keptSeconds);
    await redis.expire(BY_TIME_KEY, keptSeconds);
}

/**
 * Remembers where Slack put an alert that quotes Reddit content, under each post and comment it quotes, for as many
 * days as the alert channels keep messages. The alert's version without quotes expires as Slack deletes the alert; its
 * entries go with the first alert remembered after that, and all of them that many days after the last.
 */
export async function rememberSent(
    { redis, retentionDays }: SentStore,
    posted: Posted,
    quoting: Quoting,
): Promise<void> {
    const entries = quoting.contentIds.map((contentId: string): string => entryOf(contentId, posted));
    if (entries.length === 0) {
        // It quotes nothing: no deletion has it to redact.
        return;
    }
    const now = Date.now();
    const keptSeconds = retentionDays * SECONDS_PER_DAY;
    // The alert before its entries: an entry found has its alert, until the alert expires.
    await redis.set(alertKey(posted), JSON.stringify(quoting.withoutQuotes), {
        expiration: new Date(now + keptSeconds * MS_PER_SECOND),
    });
    await addEntries(redis, entries, { now, keptSeconds });
    await forgetOldest(redis, now, keptSeconds);
}

/** The alert as remembered: its version without quotes, read; none when it expired or is not this app's. */
function sentAlertOf(posted: Posted, value: string | null | undefined): SentAlert[] {
    if (value === null || value === undefined) {
        return [];
    }
    try {
        const withoutQuotes: unknown = JSON.parse(value);
        return isSlackMessage(withoutQuotes) ? [{ posted, withoutQuotes }] : [];
    } catch {
        // Not JSON: not a record this app wrote.
        return [];
    }
}

/** A page of a post or comment's entries, and the alerts still remembered for them. */
type Page = Readonly<{ entries: readonly string[]; alerts: readonly SentAlert[] }>;

async function firstPage(redis: SentRedis, contentId: string): Promise<Page> {
    // Its entries are those from "{contentId} " up to, but not including, "{contentId}!", "!" following " ".
    const entries = membersOf(
        await redis.zRange(BY_CONTENT_KEY, `[${contentId} `, `(${contentId}!`, {
            by: "lex",
            limit: { offset: 0, count: PAGE },
        }),
    );
    const posted = postedIn(entries);
    if (posted.length === 0) {
        return { entries, alerts: [] };
    }
    const values = await redis.mGet(posted.map(alertKey));
    return {
        entries,
        alerts: posted.flatMap((at: Posted, index: number): SentAlert[] => sentAlertOf(at, values[index])),
    };
}

/** Hands the content's alerts over a page at a time, forgetting each page once handled; whether any were found. */
async function takePages(taking: Taking, found: boolean): Promise<boolean> {
    const { redis, contentId, handle } = taking;
    const { entries, alerts } = await firstPage(redis, contentId);
    if (entries.length === 0) {
        return found;
    }
    if (alerts.length > 0) {
        await handle(alerts);
    }
    await forgetEntries(redis, entries);
    return await takePages(taking, found || alerts.length > 0);
}

/** An alert as an earlier version remembered it: under its channel and timestamp, with its version without quotes. */
function legacyAlertOf({ field, value }: Readonly<{ field: string; value: string }>): SentAlert[] {
    const [channel = "", ts = "", ...rest] = field.split(" ");
    return channel === "" || ts === "" || rest.length > 0 ? [] : sentAlertOf({ channel, ts }, value);
}

/** Hands over the alerts an earlier version remembered for the content, a page at a time, forgetting each page. */
async function takeLegacy(
    taking: Taking,
    { cursor, found }: Readonly<{ cursor: number; found: boolean }>,
): Promise<boolean> {
    const { redis, contentId, handle } = taking;
    const key = `${LEGACY_PREFIX}${contentId}`;
    const scanned = await redis.hScan(key, cursor, undefined, PAGE);
    const alerts = scanned.fieldValues.flatMap(legacyAlertOf);
    if (alerts.length > 0) {
        await handle(alerts);
    }
    if (scanned.fieldValues.length > 0) {
        await redis.hDel(
            key,
            scanned.fieldValues.map(({ field }: Readonly<{ field: string }>): string => field),
        );
    }
    const next = { cursor: scanned.cursor, found: found || alerts.length > 0 };
    return next.cursor === 0 ? next.found : await takeLegacy(taking, next);
}

/**
 * Hands the alerts remembered as quoting this post or comment to `handle`, a page at a time, forgetting each page once
 * handled, and says whether any were remembered. A page `handle` rejects stays remembered, for the deletion to be
 * handled again. An alert remembered meanwhile may be left: whoever remembered it finds the content deleted.
 */
export async function takeSent(redis: SentRedis, contentId: string, handle: SentHandler): Promise<boolean> {
    const taking = { redis, contentId, handle };
    const found = await takePages(taking, false);
    return await takeLegacy(taking, { cursor: 0, found });
}
