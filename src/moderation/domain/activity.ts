import type { ActivitySpike } from "./modAction.js";

const MS_PER_SECOND = 1000;

/** Actions within a minute of each other count toward a spike. */
export const ACTIVITY_WINDOW_MS = 60_000;

/** A moderator's fifth action within the window is a spike. */
export const ACTIVITY_SPIKE_ACTIONS = 5;

/** The spike `actionCount` actions within the window make, if they make one. */
export function activitySpike(actionCount: number): ActivitySpike | undefined {
    return actionCount >= ACTIVITY_SPIKE_ACTIONS
        ? { count: actionCount, windowSeconds: Math.floor(ACTIVITY_WINDOW_MS / MS_PER_SECOND) }
        : undefined;
}
