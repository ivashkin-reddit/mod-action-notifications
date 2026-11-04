import type { ActivitySpike } from "./modAction.js";

const MS_PER_SECOND = 1000;
/** Actions within a minute of each other count toward a spike. */
const ACTIVITY_WINDOW_MS = 60_000;
/** At most this many action times are kept per moderator. */
const MAX_TRACKED_ACTIONS = 100;

/** A moderator's fifth action within the window is a spike. */
export const ACTIVITY_SPIKE_ACTIONS = 5;

/** A moderator's recent action times (ms since the epoch) after one more action at `now`. */
export function withActionAt(previousTimes: readonly number[], now: number): readonly number[] {
    const times = [...previousTimes.filter((time: number): boolean => now - time <= ACTIVITY_WINDOW_MS), now];
    return times.length > MAX_TRACKED_ACTIONS ? times.slice(-MAX_TRACKED_ACTIONS) : times;
}

export function activitySpike(actionTimes: readonly number[]): ActivitySpike | undefined {
    return actionTimes.length >= ACTIVITY_SPIKE_ACTIONS
        ? { count: actionTimes.length, windowSeconds: Math.floor(ACTIVITY_WINDOW_MS / MS_PER_SECOND) }
        : undefined;
}
