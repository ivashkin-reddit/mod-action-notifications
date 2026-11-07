import { isBlank } from "./modAction.js";
import type { ActivitySpike, ModAction } from "./modAction.js";

const MS_PER_SECOND = 1000;

/** Actions within a minute of each other count toward a spike. */
export const ACTIVITY_WINDOW_MS = 60_000;

/** A moderator's fifth action within the window is a spike. */
export const ACTIVITY_SPIKE_ACTIONS = 5;

/** A moderator of a subreddit. */
export interface ModeratorRef {
    readonly subredditName: string;
    readonly moderatorName: string;
}

/**
 * The account whose activity the action counts toward: its moderator's, or one of Reddit's accounts', whose bursts of
 * removals are summarised like a moderator's. None for AutoModerator's actions, whose bursts are its rules at work,
 * or for an event that names no moderator or subreddit.
 */
export function activityOf(modAction: ModAction): ModeratorRef | undefined {
    const { moderatorName, subredditName } = modAction;
    if (modAction.isAutoModerator || isBlank(moderatorName) || isBlank(subredditName)) {
        return undefined;
    }
    return { subredditName, moderatorName };
}

/** The spike `actionCount` actions within the window make, if they make one. */
export function activitySpike(actionCount: number): ActivitySpike | undefined {
    return actionCount >= ACTIVITY_SPIKE_ACTIONS
        ? { count: actionCount, windowSeconds: Math.floor(ACTIVITY_WINDOW_MS / MS_PER_SECOND) }
        : undefined;
}
