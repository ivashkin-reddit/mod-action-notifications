import {
    alertsConfigured,
    configOf,
    healthReports,
    modActionPresentation,
    outboxOf,
    slackReady,
} from "./composition.js";
import type { AppContext } from "./composition.js";
import { createRedisEventStore, noteEvent } from "./health/index.js";
import {
    createModListCache,
    createRedditModerationLookups,
    createRedisModerationRecords,
    createSlackModActionAlerts,
    modActionFromTriggerEvent,
    notifyModAction,
} from "./moderation/index.js";
import type { ModActionEvent, ModerationConfig, ModerationPorts } from "./moderation/index.js";
import {
    alertOnUserDeletion,
    createRedditPostLookup,
    createRedisDeletionClaims,
    createSlackPostDeletionAlerts,
    postDeletionFromTriggerEvent,
} from "./postDeletion/index.js";
import type { PostDeleteEvent, PostDeletionConfig } from "./postDeletion/index.js";
import type { AppConfig } from "./settings/index.js";
import { forgetContent } from "./slack/delivery.js";

/**
 * The composition root's triggers: what each does when Devvit delivers its event. main.ts registers them;
 * composition.ts builds what they share with the scheduled jobs and menu items.
 */

// Each installation's mod list as last fetched, for as long as the app process lives: it can serve several.
const modListCache = createModListCache();

function moderationConfig(config: AppConfig): ModerationConfig {
    return {
        enabledActions: config.enabledActions,
        excludedModerators: config.excludedModerators,
        flagUnknownModerators: config.flagUnknownModerators,
        securityAlerts: config.securityAlerts,
        banHistoryDays: config.banHistoryDays,
        enableAutoModAlerts: config.enableAutoModAlerts,
    };
}

function moderationPorts(context: AppContext, config: AppConfig): ModerationPorts {
    return {
        records: createRedisModerationRecords(context.redis),
        lookups: createRedditModerationLookups(context.reddit, {
            cache: modListCache,
            installation: context.subredditId,
        }),
        alerts: createSlackModActionAlerts(outboxOf(context, config).send, modActionPresentation(config)),
    };
}

function postDeletionConfig(config: AppConfig): PostDeletionConfig {
    return { upvoteThreshold: config.postDeletionUpvoteThreshold };
}

export async function alertOnModAction(event: ModActionEvent, context: AppContext): Promise<void> {
    await noteEvent(createRedisEventStore(context.redis), "mod-action", 1);
    const config = await configOf(context);
    if (!(await slackReady(context, config))) {
        return;
    }
    await notifyModAction(modActionFromTriggerEvent(event), moderationConfig(config), moderationPorts(context, config));
}

/** What the app reads from a CommentDelete trigger event; Devvit's event type satisfies it. */
export type CommentDeleteEvent = Readonly<{ commentId: string }>;

/**
 * Reddit deleted a post or comment: its text leaves alerts still waiting for Slack, stays out of any queued later,
 * and is taken out of the alerts already in Slack that quote it, whether or not Slack is set up. Logs rather than
 * rejects, so a trigger goes on to its other work.
 */
async function forgetDeletedContent(contentId: string, context: AppContext): Promise<void> {
    try {
        await forgetContent(
            { redis: context.redis, scheduler: context.scheduler, health: healthReports(context) },
            contentId,
        );
    } catch (error) {
        console.error("[deletions] Could not take a deleted post or comment out of queued alerts:", error);
    }
}

async function alertOnPostDeletion(event: PostDeleteEvent, context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (!alertsConfigured(config)) {
        return;
    }
    await alertOnUserDeletion(postDeletionConfig(config), postDeletionFromTriggerEvent(event), {
        posts: createRedditPostLookup(context.reddit),
        claims: createRedisDeletionClaims(context.redis),
        alerts: createSlackPostDeletionAlerts(outboxOf(context, config).send, config.alertChannel),
    });
}

/**
 * A post was deleted: its text leaves queued alerts, then a user's own deletion of a high-score post is alerted, by
 * a link to it without its title or author.
 */
export async function onPostDelete(event: PostDeleteEvent, context: AppContext): Promise<void> {
    await noteEvent(createRedisEventStore(context.redis), "post-delete", 1);
    await forgetDeletedContent(event.postId, context);
    await alertOnPostDeletion(event, context);
}

/** A comment was deleted: its text leaves queued alerts. */
export async function onCommentDelete(event: CommentDeleteEvent, context: AppContext): Promise<void> {
    await noteEvent(createRedisEventStore(context.redis), "comment-delete", 1);
    await forgetDeletedContent(event.commentId, context);
}
