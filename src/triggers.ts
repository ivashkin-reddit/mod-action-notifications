import {
    actionNameOf,
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
    isRedditAccount,
    modActionFromTriggerEvent,
    notifyModAction,
} from "./moderation/index.js";
import type { ModAction, ModActionEvent, ModerationConfig, ModerationPorts } from "./moderation/index.js";
import {
    alertOnUserDeletion,
    createRedditPostLookup,
    createRedisDeletionClaims,
    createSlackPostDeletionAlerts,
    postDeletionFromTriggerEvent,
} from "./postDeletion/index.js";
import type { PostDeleteEvent, PostDeletionConfig } from "./postDeletion/index.js";
import {
    createRedditConfigWiki,
    createRedisSecurityStore,
    createSlackSecurityAlerts,
    watchModAction,
} from "./security/index.js";
import type { WatchedAction, WatchedActor } from "./security/index.js";
import type { AppConfig } from "./settings/index.js";
import { forgetContent } from "./slack/delivery.js";
import { countModAction, createRedisStatisticsStore } from "./statistics/index.js";
import type { ActorKind, CountedAction } from "./statistics/index.js";

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

function actorKindOf(action: ModAction): ActorKind {
    if (isRedditAccount(action.moderatorName)) {
        return "reddit";
    }
    return action.isAutoModerator ? "automoderator" : "moderators";
}

/** The action as team statistics count it: who took it, as a kind; its moderator's name is only hashed. */
function countedActionOf(action: ModAction): CountedAction {
    return {
        id: action.id,
        type: action.type,
        actor: actorKindOf(action),
        moderatorName: action.moderatorName,
        occurredAt: action.occurredAt,
        postId: action.target?.postId,
        banDays: action.banDuration,
    };
}

/** Counts the action toward the team's statistics; logs rather than rejects, as the alert matters more. */
async function countForStatistics(action: ModAction, context: AppContext): Promise<void> {
    try {
        await countModAction(countedActionOf(action), createRedisStatisticsStore(context.redis));
    } catch (error) {
        console.warn("[statistics] Could not count a mod action:", error);
    }
}

function watchedActorOf(action: ModAction): WatchedActor {
    if (isRedditAccount(action.moderatorName)) {
        return "reddit";
    }
    return action.isAutoModerator ? "automoderator" : "moderator";
}

function watchedActionOf(action: ModAction): WatchedAction {
    return {
        type: action.type,
        moderatorName: action.moderatorName,
        actor: watchedActorOf(action),
        occurredAt: action.occurredAt,
        subredditName: action.subredditName,
        targetName: action.target?.author,
    };
}

/** Watches the action for signs of a compromised account or a broken tool; logs rather than rejects. */
async function watchForSecurity(
    action: ModAction,
    context: AppContext,
    { config, ready }: Readonly<{ config: AppConfig; ready: boolean }>,
): Promise<void> {
    try {
        await watchModAction(
            watchedActionOf(action),
            {
                securityAlerts: config.securityAlerts,
                dormantModeratorDays: config.dormantModeratorDays,
                alertsReady: ready,
            },
            {
                store: createRedisSecurityStore(context.redis),
                wiki: createRedditConfigWiki(context.reddit),
                alerts: createSlackSecurityAlerts(outboxOf(context, config).send, config.alertChannel, actionNameOf),
            },
        );
    } catch (error) {
        console.warn("[security] Could not watch a mod action:", error);
    }
}

/**
 * A mod action: alerted while Slack is set up, then counted toward the team's statistics and watched for security
 * whether or not it is, with what the alert completed it with (a ban's length).
 */
export async function alertOnModAction(event: ModActionEvent, context: AppContext): Promise<void> {
    await noteEvent(createRedisEventStore(context.redis), "mod-action", 1);
    const config = await configOf(context);
    const action = modActionFromTriggerEvent(event);
    const ready = await slackReady(context, config);
    const completed = ready
        ? await notifyModAction(action, moderationConfig(config), moderationPorts(context, config))
        : action;
    await countForStatistics(completed, context);
    await watchForSecurity(completed, context, { config, ready });
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
