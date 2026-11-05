import { isBlank } from "../domain/modAction.js";
import type { ModAction, ModActionTarget } from "../domain/modAction.js";

/** What the app reads from a ModAction trigger event; Devvit's event type satisfies it. */
export type ModActionEvent = Readonly<{
    id?: string | undefined;
    action?: string | undefined;
    actionedAt?: Date | undefined;
    subreddit?: Readonly<{ name: string }> | undefined;
    moderator?: Readonly<{ name: string }> | undefined;
    targetUser?: Readonly<{ name: string }> | undefined;
    targetPost?: Readonly<{ id: string; permalink: string; selftext: string; title: string }> | undefined;
    targetComment?: Readonly<{ id: string; author: string; permalink: string; body: string }> | undefined;
}>;

/** `value`, or `fallback` when `value` is blank. */
function orIfBlank(value: string | undefined, fallback: string): string {
    return isBlank(value) ? fallback : value;
}

/**
 * What the action was done to. A comment action's event can carry the comment's post as well, so the comment comes
 * first. The target user names the author; without one, a comment falls back to its author field, while a post's
 * holds only a user ID (`authorId`), which is not a username.
 */
function targetOf(event: ModActionEvent): ModActionTarget | undefined {
    const { targetPost, targetComment } = event;
    const username = event.targetUser?.name;
    if (targetComment !== undefined && targetComment.id !== "") {
        return {
            author: orIfBlank(username, targetComment.author),
            permalink: targetComment.permalink,
            body: targetComment.body,
            isComment: true,
        };
    }
    const author = isBlank(username) ? undefined : username;
    if (targetPost !== undefined && targetPost.id !== "") {
        return {
            author,
            permalink: targetPost.permalink,
            body: orIfBlank(targetPost.selftext, targetPost.title),
            isComment: false,
        };
    }
    return author === undefined ? undefined : { author, permalink: undefined, body: undefined, isComment: false };
}

/** When the action was taken: the event's `actionedAt`, or now for an event without a valid one. */
function actionTime(actionedAt: Date | undefined): Date {
    return actionedAt === undefined || Number.isNaN(actionedAt.getTime()) ? new Date() : actionedAt;
}

/**
 * Translates a ModAction trigger event into a ModAction. Devvit's event carries no ban length, note or details, so
 * a ban's length comes from the mod log.
 */
export function modActionFromTriggerEvent(event: ModActionEvent): ModAction {
    const type = event.action ?? "";
    const moderatorName = event.moderator?.name;
    return {
        id: event.id,
        type,
        moderatorName,
        subredditName: event.subreddit?.name,
        target: targetOf(event),
        description: "",
        details: undefined,
        occurredAt: actionTime(event.actionedAt),
        isAutoModerator: (moderatorName ?? "").toLowerCase() === "automoderator",
        banDuration: undefined,
        banDurationLabel: undefined,
        relatedAction: undefined,
        activitySpike: undefined,
    };
}
