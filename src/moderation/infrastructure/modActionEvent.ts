import { isBlank } from "../domain/modAction.js";
import type { ModAction, ModActionTarget } from "../domain/modAction.js";

/** What the app reads from a ModAction trigger event; Devvit's event type satisfies it. */
export type ModActionEvent = Readonly<{
    id?: string | undefined;
    action?: string | undefined;
    subreddit?: Readonly<{ name: string }> | undefined;
    moderator?: Readonly<{ name: string }> | undefined;
    targetUser?: Readonly<{ name: string }> | undefined;
    targetPost?:
        Readonly<{ id: string; authorId: string; permalink: string; selftext: string; title: string }> | undefined;
    targetComment?: Readonly<{ id: string; author: string; permalink: string; body: string }> | undefined;
}>;

/** `value`, or `fallback` when `value` is blank. */
function orIfBlank(value: string | undefined, fallback: string): string {
    return isBlank(value) ? fallback : value;
}

function targetOf(event: ModActionEvent): ModActionTarget | undefined {
    const { targetPost, targetComment, targetUser } = event;
    if (targetPost !== undefined && targetPost.id !== "") {
        return {
            author: orIfBlank(targetUser?.name, targetPost.authorId),
            permalink: targetPost.permalink,
            body: orIfBlank(targetPost.selftext, targetPost.title),
            isComment: false,
        };
    }
    if (targetComment !== undefined && targetComment.id !== "") {
        return {
            author: orIfBlank(targetUser?.name, targetComment.author),
            permalink: targetComment.permalink,
            body: targetComment.body,
            isComment: true,
        };
    }
    const username = targetUser?.name;
    return isBlank(username)
        ? undefined
        : { author: username, permalink: undefined, body: undefined, isComment: false };
}

/**
 * Translates a ModAction trigger event into a ModAction. Devvit's event carries no ban length, note or details, so
 * a ban's length comes from the mod log. The event's `actionedAt` is not read: the action is timed by when the
 * trigger runs.
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
        occurredAt: new Date(),
        isAutoModerator: (moderatorName ?? "").toLowerCase() === "automoderator",
        banDuration: undefined,
        banDurationLabel: undefined,
        relatedAction: undefined,
        activitySpike: undefined,
    };
}
