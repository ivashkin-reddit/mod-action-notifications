import type { RecentHistory } from "./history.js";
/** What a mod action was done to. */
export interface ModActionTarget {
    /** The username of the target, or of the content's author. */
    readonly author: string | undefined;
    readonly permalink: string | undefined;
    /** The content's text, or a post's title when it has none. */
    readonly body: string | undefined;
    /** The post the action was on, or the comment's post; undefined for an action on a user. */
    readonly postId: string | undefined;
    /** The comment the action was on; undefined for an action on a post or a user. */
    readonly commentId: string | undefined;
}

/** For an unban or unmute: the ban or mute it lifts, as its record keeps it: who imposed it, when, and its details. */
export interface RelatedAction {
    readonly moderatorName: string | undefined;
    readonly occurredAt: Date | undefined;
    readonly details: string | undefined;
}

/** A burst of actions by one moderator. */
export interface ActivitySpike {
    readonly count: number;
    readonly windowSeconds: number;
}

/** A moderator's action on the subreddit. */
export interface ModAction {
    readonly id: string | undefined;
    /** Reddit's action type, such as removelink or banuser; '' when the event names none. */
    readonly type: string;
    readonly moderatorName: string | undefined;
    readonly subredditName: string | undefined;
    readonly target: ModActionTarget | undefined;
    /** The mod note or reason. */
    readonly description: string | undefined;
    readonly details: string | undefined;
    readonly occurredAt: Date;
    readonly isAutoModerator: boolean;
    /** For a ban: its length in days, 0 when permanent. */
    readonly banDuration: number | undefined;
    /** For a ban: how its length reads, when not as a number of days. */
    readonly banDurationLabel: string | undefined;
    readonly relatedAction: RelatedAction | undefined;
    readonly activitySpike: ActivitySpike | undefined;
    /** For a ban: what the user's mod notes record in the days before it, when read. */
    readonly recentHistory: RecentHistory | undefined;
}

/** A user, as the target of an action on them rather than on their content. */
export function userTarget(username: string): ModActionTarget {
    return { author: username, permalink: undefined, body: undefined, postId: undefined, commentId: undefined };
}

export function isBlank(value: string | undefined): value is "" | undefined {
    return value === undefined || value === "";
}

/** Who took an action, as alerts tell them apart. */
export type Actor = "moderator" | "unknown-moderator" | "reddit";

/**
 * Reddit's own accounts, which act in mod logs without being on any mod list: u/reddit (Crowd Control and the ban
 * evasion, harassment and mature content filters) and Anti-Evil Operations (Reddit admins' removals). Lower-cased.
 */
const REDDIT_ACCOUNTS: readonly string[] = ["reddit", "anti-evil operations"];

/** Whether the name is one of Reddit's own accounts, ignoring case. */
export function isRedditAccount(name: string | undefined): boolean {
    return name !== undefined && REDDIT_ACCOUNTS.includes(name.toLowerCase());
}

/** The action's type, or "unknown" for an event that names none. */
export function actionTypeOf(modAction: ModAction): string {
    return modAction.type === "" ? "unknown" : modAction.type;
}

/** Whether the name is AutoModerator's, ignoring case. */
export function isAutoModeratorName(name: string | undefined): boolean {
    return name?.toLowerCase() === "automoderator";
}
