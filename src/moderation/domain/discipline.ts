import { isBlank } from "./modAction.js";
import type { ModAction, RelatedAction } from "./modAction.js";

export type DisciplineKind = "ban" | "mute";

/** Whose ban or mute it is. */
export interface DisciplineSubject {
    readonly kind: DisciplineKind;
    readonly subredditName: string;
    readonly username: string;
}

/** A ban or mute imposed, or lifted. */
export interface DisciplineEvent {
    readonly change: "imposed" | "lifted";
    /** When the action was taken, in ms since the epoch. */
    readonly at: number;
    readonly moderatorName: string | undefined;
    readonly description: string | undefined;
    readonly details: string | undefined;
}

export interface DisciplineStep {
    readonly kind: DisciplineKind;
    readonly change: DisciplineEvent["change"];
}

/** Bans and mutes impose a discipline; unbans and unmutes lift it. */
export function disciplineStep(actionType: string): DisciplineStep | undefined {
    switch (actionType) {
        case "banuser": {
            return { kind: "ban", change: "imposed" };
        }
        case "muteuser": {
            return { kind: "mute", change: "imposed" };
        }
        case "unbanuser": {
            return { kind: "ban", change: "lifted" };
        }
        case "unmuteuser": {
            return { kind: "mute", change: "lifted" };
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

export function disciplineEventOf(modAction: ModAction, change: DisciplineEvent["change"]): DisciplineEvent {
    return {
        change,
        at: modAction.occurredAt.getTime(),
        moderatorName: modAction.moderatorName,
        description: modAction.description,
        details: modAction.details,
    };
}

/** Of an imposition and a lifting taken in the same instant, the imposition came first. */
const SAME_INSTANT_ORDER: Readonly<Record<DisciplineEvent["change"], number>> = { imposed: 0, lifted: 1 };

/** Events in the order they were taken. */
function byTimeTaken(first: DisciplineEvent, second: DisciplineEvent): number {
    return first.at === second.at
        ? SAME_INSTANT_ORDER[first.change] - SAME_INSTANT_ORDER[second.change]
        : first.at - second.at;
}

/**
 * The ban or mute that lifting it at `at` lifts: the latest of the subject's other events taken at or before `at`,
 * when that one imposed it. Events arrive in any order, so this goes by when each was taken: a ban that arrives
 * after the unban that lifted it still comes before that unban, and no later unban shows it.
 */
export function liftedBy(events: readonly DisciplineEvent[], at: number): RelatedAction | undefined {
    const earlier = events.filter((event: DisciplineEvent): boolean => event.at <= at).sort(byTimeTaken);
    const latest = earlier[earlier.length - 1];
    return latest?.change === "imposed"
        ? {
              moderatorName: latest.moderatorName,
              occurredAt: new Date(latest.at),
              description: latest.description,
              details: latest.details,
          }
        : undefined;
}
