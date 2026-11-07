import { createRedisApprovalStore, rememberApproval } from "./approvedEdits/index.js";
import type { ApprovalAction, Approver } from "./approvedEdits/index.js";
import {
    actionNameOf,
    alertsConfigured,
    configOf,
    healthReports,
    modActionPresentation,
    slackSendersOf,
    slackReady,
} from "./composition.js";
import type { AppContext, Installation } from "./composition.js";
import { createRedisEventStore, noteEvent } from "./health/index.js";
import {
    createModListCache,
    createRedditModerationLookups,
    createRedisModerationRecords,
    createDevvitBurstSchedule,
    createRedisBurstRecords,
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
import { countModAction, createRedisStatisticsStore, createRedisWaitingStore } from "./statistics/index.js";
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

function moderationPorts(context: AppContext, config: Installation): ModerationPorts {
    return {
        records: createRedisModerationRecords(context.redis),
        lookups: createRedditModerationLookups(context.reddit, {
            cache: modListCache,
            installation: context.subredditId,
        }),
        alerts: createSlackModActionAlerts(slackSendersOf(context, config), modActionPresentation(config)),
        bursts: createRedisBurstRecords(context.redis),
        burstSchedule: createDevvitBurstSchedule(context.scheduler),
    };
}

function postDeletionConfig(config: AppConfig): PostDeletionConfig {
    return { upvoteThreshold: config.postDeletionUpvoteThreshold };
}

/** The post or comment an action was on: the comment, for a comment; undefined for an action on a user. */
function itemIdOf(action: ModAction): string | undefined {
    const commentId = action.target?.commentId;
    return commentId === undefined || commentId === "" ? action.target?.postId : commentId;
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
        itemId: itemIdOf(action),
    };
}

/** Counts the action toward the team's statistics; logs rather than rejects, as the alert matters more. */
async function countForStatistics(action: ModAction, context: AppContext): Promise<void> {
    try {
        await countModAction(countedActionOf(action), {
            store: createRedisStatisticsStore(context.redis),
            waiting: createRedisWaitingStore(context.redis),
        });
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
    { config, ready }: Readonly<{ config: Installation; ready: boolean }>,
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
                alerts: createSlackSecurityAlerts(slackSendersOf(context, config).alerts, actionNameOf),
            },
        );
    } catch (error) {
        console.warn("[security] Could not watch a mod action:", error);
    }
}

function approverOf(action: ModAction): Approver {
    if (isRedditAccount(action.moderatorName)) {
        return "reddit";
    }
    return action.isAutoModerator ? "automoderator" : "moderator";
}

/** The action as edits after approval read it. */
function approvalActionOf(action: ModAction): ApprovalAction {
    return {
        type: action.type,
        actor: approverOf(action),
        moderatorName: action.moderatorName,
        itemId: itemIdOf(action),
        occurredAt: action.occurredAt,
    };
}

/** Remembers a moderator's approval, to alert on the author's edit after it; logs rather than rejects. */
async function rememberForEdits(action: ModAction, context: AppContext, config: AppConfig): Promise<void> {
    try {
        await rememberApproval(
            approvalActionOf(action),
            config.editsAfterApprovalDays,
            createRedisApprovalStore(context.redis),
        );
    } catch (error) {
        console.warn("[approvededits] Could not remember an approval, so an edit after it will not be alerted:", error);
    }
}

/**
 * A mod action: alerted while Slack is set up, then counted toward the team's statistics, watched for security and
 * remembered if it approves something, whether or not it is, with what the alert completed it with (a ban's length).
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
    await rememberForEdits(completed, context, config);
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
        alerts: createSlackPostDeletionAlerts(slackSendersOf(context, config).alerts),
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
