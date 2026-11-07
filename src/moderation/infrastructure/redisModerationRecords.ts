import type { TriggerContext } from "@devvit/public-api";
import type { ModerationRecords } from "../application/ports.js";
import type { ModeratorRef } from "../domain/activity.js";
import type { DisciplineEvent, DisciplineSubject } from "../domain/discipline.js";

const MS_PER_SECOND = 1000;
const ACTIVITY_RETENTION_SECONDS = 3600;
/** At most this many of a moderator's actions are kept. */
const MAX_TRACKED_ACTIONS = 100;
/** 90 days. */
const DISCIPLINE_RETENTION_SECONDS = 7_776_000;
/** At most this many of a user's bans, mutes and liftings are kept: an unban needs only the latest. */
const MAX_DISCIPLINE_EVENTS = 20;
/** How long a reported action is remembered, so that Devvit delivering it again sends no second alert. A day. */
const REPORT_MEMORY_SECONDS = 86_400;

type ModerationRedis = Readonly<
    Pick<
        TriggerContext["redis"],
        "get" | "set" | "del" | "expire" | "zAdd" | "zRemRangeByScore" | "zRemRangeByRank" | "zRange"
    >
>;

type ActivityRecords = Pick<ModerationRecords, "countAction">;
type DisciplineRecords = Pick<ModerationRecords, "recordDiscipline" | "disciplineEvents">;
type ReportRecords = Pick<ModerationRecords, "claimReport">;

// Installations already hold values under these keys, in these shapes.
/** A subreddit or account name as the keys hold it: lower case, with spaces and colons as underscores. */
export function keyPart(value: string): string {
    return value.toLowerCase().replace(/[\s:]/gu, "_");
}

/**
 * A sorted set of the moderator's recent actions, scored by when each was taken. (Versions before it kept a JSON
 * list under mod_actions:moderator_activity:*, which expires within the hour.)
 */
function activityKey({ subredditName, moderatorName }: ModeratorRef): string {
    return `mod_actions:moderator_actions:${keyPart(subredditName)}:${keyPart(moderatorName)}`;
}

/** The member an action is counted under: its ID, or, for an action without one, a member of its own. */
function activityMember(id: string | undefined, at: number): string {
    return id === undefined || id === "" ? `${String(at)}:${String(Math.random())}` : id;
}

/** Present while the mod action with this ID has been reported within the last day. */
function reportedKey(actionId: string): string {
    return `mod_actions:reported:${actionId}`;
}

/** A sorted set of the user's bans or mutes and their liftings, scored by when each was taken. */
function disciplineKey({ kind, subredditName, username }: DisciplineSubject): string {
    return `mod_actions:discipline_events:${kind}:${keyPart(subredditName)}:${keyPart(username)}`;
}

/**
 * Where versions before the sorted sets kept the user's latest ban or mute, as JSON with a 90-day TTL. Read once
 * and carried over (see legacyDiscipline); nothing writes here any more, so these keys are gone 90 days after an
 * installation upgrades, and this key and the reading of it can go then.
 */
function legacyDisciplineKey({ kind, subredditName, username }: DisciplineSubject): string {
    return `mod_actions:discipline:${kind}:${keyPart(subredditName)}:${keyPart(username)}`;
}

/**
 * The member an event is stored as: its fields as JSON, so the same event recorded twice is one member. Members an
 * earlier version stored also hold the mod note; it is not read, and leaves with them, within 90 days.
 */
function memberOf({ change, at, moderatorName, details }: DisciplineEvent): string {
    return JSON.stringify({ change, at, moderatorName: moderatorName ?? null, details: details ?? null });
}

/** Stored JSON as an object; undefined for anything else. */
function storedObject(raw: string): Readonly<Record<string, unknown>> | undefined {
    try {
        const parsed: unknown = JSON.parse(raw);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? Object.fromEntries(Object.entries(parsed))
            : undefined;
    } catch {
        // Not JSON: a value this app did not write.
        return undefined;
    }
}

function text(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

/** A stored event; undefined for a member that is not one. */
function eventOf(member: string): DisciplineEvent | undefined {
    const stored = storedObject(member);
    const change = stored?.["change"];
    const at = stored?.["at"];
    if ((change !== "imposed" && change !== "lifted") || typeof at !== "number") {
        return undefined;
    }
    return {
        change,
        at,
        moderatorName: text(stored?.["moderatorName"]),
        details: text(stored?.["details"]),
    };
}

/**
 * A ban or mute an earlier version stored, as an imposition, without the mod note it held; undefined when it has no
 * time to place it by.
 */
function legacyEventOf(raw: string): DisciplineEvent | undefined {
    const stored = storedObject(raw);
    const timestamp = stored?.["timestamp"];
    if (typeof timestamp !== "number" || timestamp <= 0) {
        return undefined;
    }
    return {
        change: "imposed",
        at: timestamp,
        moderatorName: text(stored?.["moderatorName"]),
        details: text(stored?.["details"]),
    };
}

// Each command is atomic, so actions counted at once cannot overwrite each other.
function activityRecords(redis: ModerationRedis): ActivityRecords {
    return {
        countAction: async (
            moderator: ModeratorRef,
            { id, at }: Readonly<{ id: string | undefined; at: number }>,
            windowMs: number,
        ): Promise<number> => {
            const key = activityKey(moderator);
            await redis.zAdd(key, { member: activityMember(id, at), score: at });
            await redis.zRemRangeByScore(key, 0, at - windowMs - 1);
            await redis.zRemRangeByRank(key, 0, -(MAX_TRACKED_ACTIONS + 1));
            await redis.expire(key, ACTIVITY_RETENTION_SECONDS);
            return (await redis.zRange(key, at - windowMs, at, { by: "score" })).length;
        },
    };
}

// Each event is one atomic ZADD, so a ban and its unban arriving at once, in either order, are both kept.
function disciplineRecords(redis: ModerationRedis): DisciplineRecords {
    const recordDiscipline = async (subject: DisciplineSubject, event: DisciplineEvent): Promise<void> => {
        const key = disciplineKey(subject);
        await redis.zAdd(key, { member: memberOf(event), score: event.at });
        await redis.zRemRangeByScore(key, 0, Date.now() - DISCIPLINE_RETENTION_SECONDS * MS_PER_SECOND);
        await redis.zRemRangeByRank(key, 0, -(MAX_DISCIPLINE_EVENTS + 1));
        await redis.expire(key, DISCIPLINE_RETENTION_SECONDS);
    };
    /**
     * Carries over the ban or mute an earlier version stored for the subject, if any, and returns it. A read, then
     * writes, against the rule of single atomic commands, and still safe: nothing writes the old key any more, so
     * handlers carrying it over at once read the same value, add the same member (one ZADD keeps it once) and
     * delete the same key.
     */
    const legacyDiscipline = async (subject: DisciplineSubject): Promise<readonly DisciplineEvent[]> => {
        const raw = await redis.get(legacyDisciplineKey(subject));
        if (raw === undefined) {
            return [];
        }
        const event = legacyEventOf(raw);
        if (event !== undefined) {
            await recordDiscipline(subject, event);
        }
        await redis.del(legacyDisciplineKey(subject));
        return event === undefined ? [] : [event];
    };
    return {
        recordDiscipline,
        disciplineEvents: async (subject: DisciplineSubject): Promise<readonly DisciplineEvent[]> => {
            const members = await redis.zRange(disciplineKey(subject), 0, -1, { by: "rank" });
            if (members.length === 0) {
                return await legacyDiscipline(subject);
            }
            return members
                .map(({ member }: Readonly<{ member: string }>): DisciplineEvent | undefined => eventOf(member))
                .filter((event: DisciplineEvent | undefined): event is DisciplineEvent => event !== undefined);
        },
    };
}

// One atomic SET NX, so deliveries of one action handled at once cannot both claim its report. Redis answers an NX
// set that finds the key with nil, which Devvit returns as "".
function reportRecords(redis: ModerationRedis): ReportRecords {
    return {
        claimReport: async (actionId: string): Promise<boolean> =>
            (await redis.set(reportedKey(actionId), "1", {
                nx: true,
                expiration: new Date(Date.now() + REPORT_MEMORY_SECONDS * MS_PER_SECOND),
            })) !== "",
    };
}

export function createRedisModerationRecords(redis: ModerationRedis): ModerationRecords {
    return { ...activityRecords(redis), ...disciplineRecords(redis), ...reportRecords(redis) };
}
