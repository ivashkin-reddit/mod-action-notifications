/** What a mod action was done to. */
export interface ModActionTarget {
    /** The username of the target, or of the content's author. */
    readonly author: string | undefined;
    readonly permalink: string | undefined;
    /** The content's text, or a post's title when it has none. */
    readonly body: string | undefined;
    readonly isComment: boolean;
}

/** For an unban or unmute: the ban or mute it lifts. */
export interface RelatedAction {
    readonly moderatorName: string | undefined;
    readonly occurredAt: Date | undefined;
    readonly description: string | undefined;
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
}

export function isBlank(value: string | undefined): value is "" | undefined {
    return value === undefined || value === "";
}

/** The action's type, or "unknown" for an event that names none. */
export function actionTypeOf(modAction: ModAction): string {
    return modAction.type === "" ? "unknown" : modAction.type;
}

/** The acting moderator's name, or "Unknown" for an event that names none. */
export function moderatorOf(modAction: ModAction): string {
    return isBlank(modAction.moderatorName) ? "Unknown" : modAction.moderatorName;
}

/** Whether the moderator is in the comma-separated exclusion list, ignoring case and spaces. */
export function isExcludedModerator(moderatorName: string, excludedModerators: string): boolean {
    if (excludedModerators === "") {
        return false;
    }
    return excludedModerators
        .split(",")
        .map((name: string): string => name.trim().toLowerCase())
        .filter((name: string): boolean => name.length > 0)
        .includes(moderatorName.toLowerCase());
}
