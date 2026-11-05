import type { Condition, InForce } from "../domain/conditions.js";
import type { Counts, HealthEvent, LastSeen } from "../domain/events.js";

/** Where what the app has done is kept: when each event last happened, and each UTC day's counts. */
export interface EventStore {
    /** Notes `count` of the event at `at`, in ms since the epoch. */
    readonly note: (event: HealthEvent, count: number, at: number) => Promise<void>;
    /** Rejects when Redis cannot be read. */
    readonly lastSeen: () => Promise<LastSeen>;
    /** The counts of a UTC day such as 2026-11-04. Rejects when Redis cannot be read. */
    readonly counts: (day: string) => Promise<Counts>;
}

/** Where the conditions in force are kept. */
export interface ConditionStore {
    /**
     * Records the condition as in force from `since`, in ms since the epoch, with what the app saw of it: false when
     * it already was.
     */
    readonly start: (condition: Condition, since: number, detail: string) => Promise<boolean>;
    /** When the condition came into force, in ms since the epoch; undefined when it is not in force. */
    readonly since: (condition: Condition) => Promise<number | undefined>;
    /** Claims the condition's reminder for `seconds`: false when it was claimed within them. */
    readonly claimReminder: (condition: Condition, seconds: number) => Promise<boolean>;
    /** The conditions in force. Rejects when they cannot be read. */
    readonly inForce: () => Promise<readonly InForce[]>;
    /** Records that the condition is no longer in force: false when it was not. */
    readonly end: (condition: Condition) => Promise<boolean>;
}
