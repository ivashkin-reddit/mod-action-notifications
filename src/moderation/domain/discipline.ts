import { isBlank } from "./modAction.js";
import type { ModAction } from "./modAction.js";

export type DisciplineKind = "ban" | "mute";

/** Whose ban or mute it is. */
export interface DisciplineSubject {
    readonly kind: DisciplineKind;
    readonly subredditName: string;
    readonly username: string;
}

/** A ban or mute, remembered so the unban or unmute that lifts it can mention it. */
export interface DisciplineRecord {
    readonly moderatorName: string;
    /** Ms since the epoch. */
    readonly occurredAt: number;
    readonly description: string | undefined;
    readonly details: string | undefined;
}

export interface DisciplineStep {
    readonly kind: DisciplineKind;
    readonly step: "remember" | "recall";
}

/** Bans and mutes are remembered; unbans and unmutes recall the ban or mute they lift. */
export function disciplineStep(actionType: string): DisciplineStep | undefined {
    switch (actionType) {
        case "banuser": {
            return { kind: "ban", step: "remember" };
        }
        case "muteuser": {
            return { kind: "mute", step: "remember" };
        }
        case "unbanuser": {
            return { kind: "ban", step: "recall" };
        }
        case "unmuteuser": {
            return { kind: "mute", step: "recall" };
        }
        default: {
            return undefined;
        }
    }
}

/** Whose ban or mute the action concerns; undefined when it names no subreddit or no user. */
export function disciplineSubject(kind: DisciplineKind, modAction: ModAction): DisciplineSubject | undefined {
    const username = modAction.target?.author;
    if (isBlank(modAction.subredditName) || isBlank(username)) {
        return undefined;
    }
    return { kind, subredditName: modAction.subredditName, username };
}

export function disciplineRecordOf(modAction: ModAction): DisciplineRecord {
    return {
        moderatorName: modAction.moderatorName ?? "Unknown",
        occurredAt: modAction.occurredAt.getTime(),
        description: modAction.description,
        details: modAction.details,
    };
}
