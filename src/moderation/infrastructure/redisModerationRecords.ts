import type { TriggerContext } from "@devvit/public-api";
import type { ModerationRecords, ModeratorRef } from "../application/ports.js";
import type { DisciplineRecord, DisciplineSubject } from "../domain/discipline.js";
import type { RelatedAction } from "../domain/modAction.js";

const MS_PER_SECOND = 1000;
const ACTIVITY_RETENTION_SECONDS = 3600;
/** 90 days. */
const DISCIPLINE_RETENTION_SECONDS = 7_776_000;

type ModerationRedis = Readonly<Pick<TriggerContext["redis"], "get" | "set" | "del">>;

// Installations already hold values under these keys, in these shapes.
function keyPart(value: string): string {
    return value.toLowerCase().replace(/[\s:]/gu, "_");
}

function activityKey({ subredditName, moderatorName }: ModeratorRef): string {
    return `mod_actions:moderator_activity:${keyPart(subredditName)}:${keyPart(moderatorName)}`;
}

function disciplineKey({ kind, subredditName, username }: DisciplineSubject): string {
    return `mod_actions:discipline:${kind}:${keyPart(subredditName)}:${keyPart(username)}`;
}

function expiringIn(seconds: number): { readonly expiration: Date } {
    return { expiration: new Date(Date.now() + seconds * MS_PER_SECOND) };
}

/** The action times in a stored activity record; [] for one that is not a list. */
function parseActionTimes(raw: string): readonly number[] {
    try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed)
            ? parsed.filter((value: unknown): value is number => typeof value === "number")
            : [];
    } catch {
        return [];
    }
}

/** A stored ban or mute; fields that are missing or of the wrong type read as absent. */
function relatedActionOf(stored: unknown): RelatedAction {
    const record = typeof stored === "object" && stored !== null ? stored : {};
    const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);
    return {
        moderatorName: "moderatorName" in record ? text(record.moderatorName) : undefined,
        occurredAt:
            "timestamp" in record && typeof record.timestamp === "number" && record.timestamp !== 0
                ? new Date(record.timestamp)
                : undefined,
        description: "description" in record ? text(record.description) : undefined,
        details: "details" in record ? text(record.details) : undefined,
    };
}

/** A stored ban or mute, or null when it is not JSON. */
function parseDiscipline(raw: string): RelatedAction | null {
    try {
        return relatedActionOf(JSON.parse(raw));
    } catch {
        return null;
    }
}

export function createRedisModerationRecords(redis: ModerationRedis): ModerationRecords {
    return {
        recentActionTimes: async (moderator: ModeratorRef): Promise<readonly number[]> => {
            const raw = await redis.get(activityKey(moderator));
            return raw === undefined || raw === "" ? [] : parseActionTimes(raw);
        },
        keepRecentActionTimes: async (moderator: ModeratorRef, times: readonly number[]): Promise<void> => {
            await redis.set(activityKey(moderator), JSON.stringify(times), expiringIn(ACTIVITY_RETENTION_SECONDS));
        },
        rememberDiscipline: async (subject: DisciplineSubject, record: DisciplineRecord): Promise<void> => {
            const stored = {
                type: subject.kind,
                moderatorName: record.moderatorName,
                timestamp: record.occurredAt,
                description: record.description ?? null,
                details: record.details ?? null,
            };
            await redis.set(disciplineKey(subject), JSON.stringify(stored), expiringIn(DISCIPLINE_RETENTION_SECONDS));
        },
        rememberedDiscipline: async (subject: DisciplineSubject): Promise<RelatedAction | null | undefined> => {
            const raw = await redis.get(disciplineKey(subject));
            return raw === undefined || raw === "" ? undefined : parseDiscipline(raw);
        },
        forgetDiscipline: async (subject: DisciplineSubject): Promise<void> => {
            await redis.del(disciplineKey(subject));
        },
    };
}
