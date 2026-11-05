import { actionTypeOf } from "./modAction.js";
import type { ModAction } from "./modAction.js";

/** Which mod actions moderators are told about. */
export interface AlertRules {
    /** Reddit's action types to report, such as removelink. */
    readonly enabledActions: readonly string[];
    /** Lower-cased usernames whose actions are not reported. */
    readonly excludedModerators: readonly string[];
    readonly enableAutoModAlerts: boolean;
}

/**
 * Whether moderators are told about the action: its type is enabled, its moderator is not excluded, and it is not
 * AutoModerator's while AutoModerator alerts are off.
 */
export function isReported(modAction: ModAction, rules: AlertRules): boolean {
    const moderatorName = (modAction.moderatorName ?? "").toLowerCase();
    return (
        rules.enabledActions.includes(actionTypeOf(modAction)) &&
        !rules.excludedModerators.includes(moderatorName) &&
        (rules.enableAutoModAlerts || !modAction.isAutoModerator)
    );
}
