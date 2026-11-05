import type { Condition } from "../domain/conditions.js";

/** Where the conditions in force are kept. */
export interface ConditionStore {
    /** Records the condition as in force from `since`, in ms since the epoch: false when it already was. */
    readonly start: (condition: Condition, since: number) => Promise<boolean>;
    /** When the condition came into force, in ms since the epoch; undefined when it is not in force. */
    readonly since: (condition: Condition) => Promise<number | undefined>;
    /** Claims the condition's reminder for `seconds`: false when it was claimed within them. */
    readonly claimReminder: (condition: Condition, seconds: number) => Promise<boolean>;
    /** Records that the condition is no longer in force: false when it was not. */
    readonly end: (condition: Condition) => Promise<boolean>;
}
