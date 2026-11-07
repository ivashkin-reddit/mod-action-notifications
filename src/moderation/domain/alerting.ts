import { actionTypeOf } from "./modAction.js";
import type { ModAction } from "./modAction.js";

/** Which mod actions moderators are told about. */
export interface AlertRules {
    /** Reddit's action types to report, such as removelink. */
    readonly enabledActions: readonly string[];
    /** Lower-cased usernames whose actions are not reported. */
    readonly excludedModerators: readonly string[];
    readonly enableAutoModAlerts: boolean;
    /** Report every security action, as a security alert, whatever the other rules say. */
    readonly securityAlerts: boolean;
}

/**
 * Actions that change who moderates the subreddit and with which permissions, or which apps act in it: what a
 * compromised moderator account would do first.
 */
const SECURITY_ACTIONS: ReadonlySet<string> = new Set([
    "addmoderator",
    "removemoderator",
    "invitemoderator",
    "acceptmoderatorinvite",
    "setpermissions",
    "dev_platform_app_installed",
    "dev_platform_app_uninstalled",
    "dev_platform_app_enabled",
    "dev_platform_app_disabled",
    "dev_platform_app_changed",
]);

export function isSecurityAction(modAction: ModAction): boolean {
    return SECURITY_ACTIONS.has(actionTypeOf(modAction));
}

/**
 * Whether moderators are told about the action: a security action while security alerts are on; otherwise one of
 * an enabled type, by a moderator not excluded, and not AutoModerator's while AutoModerator alerts are off.
 */
export function isReported(modAction: ModAction, rules: AlertRules): boolean {
    if (rules.securityAlerts && isSecurityAction(modAction)) {
        return true;
    }
    const moderatorName = (modAction.moderatorName ?? "").toLowerCase();
    return (
        rules.enabledActions.includes(actionTypeOf(modAction)) &&
        !rules.excludedModerators.includes(moderatorName) &&
        (rules.enableAutoModAlerts || !modAction.isAutoModerator)
    );
}
