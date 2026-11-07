/**
 * The mod action types this app knows: how moderators choose each on a form, and how alerts name and colour it.
 * The one list of them; the settings form and the Simulate Mod Action form offer choices from it.
 */
interface ActionStyle {
    /** How a form offers the action, e.g. "Remove Post". */
    readonly label: string;
    readonly emoji: string;
    /** How an alert names the action, e.g. "Post Removed". */
    readonly name: string;
    /** The name when the action targets a comment, where it differs. */
    readonly commentName?: string;
    readonly color: string;
}

/** In the order the settings form lists them. */
const ACTION_STYLES: ReadonlyMap<string, ActionStyle> = new Map([
    ["removelink", { label: "Remove Post", emoji: "🗑️", name: "Post Removed", color: "#ff4444" }],
    ["removecomment", { label: "Remove Comment", emoji: "🗑️", name: "Comment Removed", color: "#ff4444" }],
    ["spamlink", { label: "Spam Post", emoji: "🚫", name: "Post Marked as Spam", color: "#ff0088" }],
    ["spamcomment", { label: "Spam Comment", emoji: "🚫", name: "Comment Marked as Spam", color: "#ff0088" }],
    ["approvelink", { label: "Approve Post", emoji: "✅", name: "Post Approved", color: "#00cc00" }],
    ["approvecomment", { label: "Approve Comment", emoji: "✅", name: "Comment Approved", color: "#00cc00" }],
    ["banuser", { label: "Ban User", emoji: "🔨", name: "User Banned", color: "#cc0000" }],
    ["unbanuser", { label: "Unban User", emoji: "🎉", name: "User Unbanned", color: "#00cc00" }],
    ["lock", { label: "Lock Post", emoji: "🔒", name: "Post Locked", commentName: "Comment Locked", color: "#ff8800" }],
    [
        "unlock",
        { label: "Unlock Post", emoji: "🔓", name: "Post Unlocked", commentName: "Comment Unlocked", color: "#00cc00" },
    ],
    ["sticky", { label: "Sticky Post", emoji: "📌", name: "Post Stickied", color: "#0088ff" }],
    ["unsticky", { label: "Unsticky Post", emoji: "📌", name: "Post Unstickied", color: "#888888" }],
    ["editflair", { label: "Edit Flair", emoji: "🏷️", name: "Flair Edited", color: "#8800ff" }],
    ["muteuser", { label: "Mute User", emoji: "🔇", name: "User Muted", color: "#ff8800" }],
    ["unmuteuser", { label: "Unmute User", emoji: "🔊", name: "User Unmuted", color: "#00cc00" }],
    ["distinguish", { label: "Distinguish Post/Comment", emoji: "⭐", name: "Distinguished", color: "#0088ff" }],
    ["ignorereports", { label: "Ignore Reports", emoji: "🔕", name: "Reports Ignored", color: "#888888" }],
    ["unignorereports", { label: "Unignore Reports", emoji: "🔔", name: "Reports Unignored", color: "#00cc00" }],
    ["snoozereports", { label: "Snooze Reports", emoji: "⏰", name: "Reports Snoozed", color: "#ff8800" }],
    ["unsnoozereports", { label: "Unsnooze Reports", emoji: "⏰", name: "Reports Unsnoozed", color: "#00cc00" }],
    ["addcontributor", { label: "Add Approved User", emoji: "✅", name: "Approved User Added", color: "#00cc00" }],
    [
        "removecontributor",
        { label: "Remove Approved User", emoji: "❌", name: "Approved User Removed", color: "#ff4444" },
    ],
    ["invitemoderator", { label: "Invite Moderator", emoji: "📨", name: "Moderator Invited", color: "#0088ff" }],
    ["uninvitemoderator", { label: "Uninvite Moderator", emoji: "📭", name: "Moderator Uninvited", color: "#ff8800" }],
    [
        "acceptmoderatorinvite",
        { label: "Accept Moderator Invite", emoji: "✅", name: "Moderator Invite Accepted", color: "#00cc00" },
    ],
    ["addmoderator", { label: "Add Moderator", emoji: "👤", name: "Moderator Added", color: "#0088ff" }],
    ["removemoderator", { label: "Remove Moderator", emoji: "👤", name: "Moderator Removed", color: "#ff4444" }],
    ["editsettings", { label: "Edit Settings", emoji: "⚙️", name: "Settings Edited", color: "#8800ff" }],
    [
        "adjust_post_crowd_control_level",
        { label: "Adjust Crowd Control Level", emoji: "👥", name: "Crowd Control Adjusted", color: "#ff8800" },
    ],
    [
        "enable_post_crowd_control_filter",
        { label: "Enable Crowd Control Filter", emoji: "🛡️", name: "Crowd Control Enabled", color: "#ff8800" },
    ],
    [
        "disable_post_crowd_control_filter",
        { label: "Disable Crowd Control Filter", emoji: "🛡️", name: "Crowd Control Disabled", color: "#00cc00" },
    ],
    [
        "setpermissions",
        { label: "Change Moderator Permissions", emoji: "🔑", name: "Moderator Permissions Changed", color: "#ff8800" },
    ],
    ["wikirevise", { label: "Edit Wiki Page", emoji: "📝", name: "Wiki Page Edited", color: "#8800ff" }],
    ["createrule", { label: "Create Rule", emoji: "📜", name: "Rule Created", color: "#0088ff" }],
    ["editrule", { label: "Edit Rule", emoji: "📜", name: "Rule Edited", color: "#8800ff" }],
    ["deleterule", { label: "Delete Rule", emoji: "📜", name: "Rule Deleted", color: "#ff4444" }],
    ["reorderrules", { label: "Reorder Rules", emoji: "📜", name: "Rules Reordered", color: "#888888" }],
    [
        "edit_post_requirements",
        { label: "Edit Post Requirements", emoji: "📋", name: "Post Requirements Edited", color: "#8800ff" },
    ],
    ["dev_platform_app_installed", { label: "Install App", emoji: "🧩", name: "App Installed", color: "#0088ff" }],
    [
        "dev_platform_app_uninstalled",
        { label: "Uninstall App", emoji: "🧩", name: "App Uninstalled", color: "#ff4444" },
    ],
    ["dev_platform_app_enabled", { label: "Enable App", emoji: "🧩", name: "App Enabled", color: "#00cc00" }],
    ["dev_platform_app_disabled", { label: "Disable App", emoji: "🧩", name: "App Disabled", color: "#ff8800" }],
    ["dev_platform_app_changed", { label: "Change App", emoji: "🧩", name: "App Changed", color: "#8800ff" }],
]);

const UNKNOWN_ACTION_COLOR = "#666666";

/** A mod action type as a choice on a form. */
export type ActionChoice = Readonly<{ label: string; value: string }>;

/** The given action types, each as a choice; a type this catalog does not know is offered by itself. */
export function actionChoices(types: readonly string[]): readonly ActionChoice[] {
    return types.map((type: string): ActionChoice => ({ label: ACTION_STYLES.get(type)?.label ?? type, value: type }));
}

/** What the Enabled Mod Actions setting offers: every type this app knows, and those alerted about until chosen. */
export const ENABLED_ACTIONS_CHOICES: Readonly<{ options: readonly ActionChoice[]; defaults: readonly string[] }> = {
    options: actionChoices([...ACTION_STYLES.keys()]),
    defaults: ["removelink", "removecomment", "spamlink", "spamcomment", "banuser", "unbanuser"],
};

/** The action's name, e.g. "Post Removed"; an unknown type is named by itself. */
export function actionName(type: string, isComment: boolean): string {
    const style = ACTION_STYLES.get(type);
    if (style === undefined) {
        return type;
    }
    return isComment && style.commentName !== undefined ? style.commentName : style.name;
}

/** The action's name with its emoji, e.g. "🗑️ Post Removed"; an unknown type is named by itself. */
export function actionTitle(type: string, isComment: boolean): string {
    const style = ACTION_STYLES.get(type);
    return style === undefined ? type : `${style.emoji} ${actionName(type, isComment)}`;
}

export function actionColor(type: string): string {
    return ACTION_STYLES.get(type)?.color ?? UNKNOWN_ACTION_COLOR;
}
