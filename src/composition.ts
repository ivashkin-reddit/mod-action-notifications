import type { TriggerContext } from "@devvit/public-api";
import { clearCondition, createRedisConditionStore, raiseCondition } from "./health/index.js";
import type { Condition } from "./health/index.js";
import {
    createModListCache,
    createRedditModerationLookups,
    createRedisModerationRecords,
    createSlackModActionAlerts,
    modActionFromTriggerEvent,
    notifyModAction,
} from "./moderation/index.js";
import type { ModActionEvent, ModActionPresentation, ModerationConfig, ModerationPorts } from "./moderation/index.js";
import {
    checkModqueue,
    createDevvitMonitorScheduler,
    createRedisMonitorStore,
    createSlackModqueueAlerts,
    openRedditQueues,
    setupMonitoring,
} from "./modqueue/index.js";
import type {
    ModerationQueues,
    MonitorHealth,
    MonitorJobPorts,
    MonitoringSetup,
    MonitorThresholds,
} from "./modqueue/index.js";
import {
    alertOnUserDeletion,
    createRedditPostLookup,
    createRedisDeletionClaims,
    createSlackPostDeletionAlerts,
    postDeletionFromTriggerEvent,
} from "./postDeletion/index.js";
import type { PostDeleteEvent, PostDeletionConfig } from "./postDeletion/index.js";
import { createConfigLoader } from "./settings/index.js";
import type { AppConfig } from "./settings/index.js";
import { createSlackOutbox, forgetContent } from "./slack/delivery.js";
import type { DeliveryHealth, SlackOutbox } from "./slack/delivery.js";

/**
 * The composition root's wiring: for each trigger and scheduler job, read the settings and build the capability's
 * adapters from that handler's context. main.ts registers the handlers, and menuActions.ts does what menu items and
 * forms do. Without a webhook, alerts have nowhere to go: the handlers that send them do nothing.
 */

/** The Devvit APIs the app calls. Trigger, scheduler, menu and form contexts all satisfy this. */
export type AppContext = Readonly<{
    settings: Readonly<Pick<TriggerContext["settings"], "get">>;
    redis: Readonly<
        Pick<
            TriggerContext["redis"],
            | "get"
            | "set"
            | "del"
            | "incrBy"
            | "expire"
            | "zAdd"
            | "zRem"
            | "zRemRangeByScore"
            | "zRemRangeByRank"
            | "zRange"
            | "zScore"
            | "hSetNX"
            | "hGet"
            | "hGetAll"
            | "hDel"
            | "zCard"
        >
    >;
    reddit: Readonly<
        Pick<
            TriggerContext["reddit"],
            "getCurrentSubreddit" | "getCurrentSubredditName" | "getModerationLog" | "getPostById"
        >
    >;
    scheduler: Readonly<Pick<TriggerContext["scheduler"], "runJob" | "cancelJob" | "listJobs">>;
    /** Identifies the installation: one app process can serve several. */
    subredditId: string;
    /** The version of the app that is running. */
    appVersion: string;
    subredditName?: string | undefined;
}>;

// These live as long as the app process, which can serve several installations: each installation's last settings
// read successfully, and its mod list as last fetched.
const loadConfig = createConfigLoader();
const modListCache = createModListCache();

export async function configOf(context: AppContext): Promise<AppConfig> {
    return await loadConfig(context.settings, context.subredditId);
}

export function alertsConfigured(config: AppConfig): boolean {
    return config.slackWebhookUrl !== "";
}

/** Whether alerts can be sent, noting for the health log whether the webhook URL is missing or not a Slack one. */
async function webhookReady(context: AppContext, config: AppConfig): Promise<boolean> {
    const conditions = createRedisConditionStore(context.redis);
    const missing = !alertsConfigured(config) && !config.slackWebhookUrlInvalid;
    await (missing ? raiseCondition(conditions, "webhook-missing", "") : clearCondition(conditions, "webhook-missing"));
    await (config.slackWebhookUrlInvalid
        ? raiseCondition(conditions, "webhook-invalid", "")
        : clearCondition(conditions, "webhook-invalid"));
    return alertsConfigured(config);
}

function moderationConfig(config: AppConfig): ModerationConfig {
    return {
        enabledActions: config.enabledActions,
        excludedModerators: config.excludedModerators,
        flagUnknownModerators: config.flagUnknownModerators,
        enableAutoModAlerts: config.enableAutoModAlerts,
    };
}

export function monitorThresholds(config: AppConfig): MonitorThresholds {
    return {
        queueSizeThreshold: config.modqueueThreshold,
        unmoderatedAgeHours: config.unmoderatedAgeHours,
        reportedAgeHours: config.reportedContentAgeHours,
    };
}

function postDeletionConfig(config: AppConfig): PostDeletionConfig {
    return { upvoteThreshold: config.postDeletionUpvoteThreshold };
}

/** The installation's health log, where the outbox and the monitor report lasting problems. */
function healthReports(context: AppContext): DeliveryHealth & MonitorHealth {
    const conditions = createRedisConditionStore(context.redis);
    return {
        raise: async (condition: Condition, detail: string): Promise<void> => {
            await raiseCondition(conditions, condition, detail);
        },
        clear: async (condition: Condition): Promise<void> => {
            await clearCondition(conditions, condition);
        },
    };
}

/** The installation's Slack outbox, through which every alert goes. */
function outboxOf(context: AppContext, config: AppConfig): SlackOutbox {
    return createSlackOutbox({
        webhookUrl: config.slackWebhookUrl,
        redis: context.redis,
        scheduler: context.scheduler,
        health: healthReports(context),
    });
}

export function modActionPresentation(config: AppConfig): ModActionPresentation {
    return {
        includeModNote: config.includeModNote,
        notificationChannel: config.notificationChannel,
        alertChannel: config.alertChannel,
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

function monitorJobPorts(context: AppContext): MonitorJobPorts {
    return {
        store: createRedisMonitorStore(context.redis),
        scheduler: createDevvitMonitorScheduler(context.scheduler),
    };
}

export async function alertOnModAction(event: ModActionEvent, context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (!(await webhookReady(context, config))) {
        return;
    }
    await notifyModAction(modActionFromTriggerEvent(event), moderationConfig(config), moderationPorts(context, config));
}

/** Schedules the monitor while any of its thresholds is above 0, and cancels it otherwise, logging which. */
export async function setUpModqueueMonitor(context: AppContext): Promise<MonitoringSetup> {
    const config = await configOf(context);
    const setup = await setupMonitoring(monitorThresholds(config), monitorJobPorts(context));
    console.info(
        setup.enabled
            ? "[setup] The modqueue monitor is on"
            : "[setup] The modqueue monitor is off: all its thresholds are 0",
    );
    return setup;
}

export async function runModqueueMonitor(context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (!alertsConfigured(config)) {
        return;
    }
    await checkModqueue(monitorThresholds(config), {
        openQueues: async (): Promise<ModerationQueues> => await openRedditQueues(context.reddit),
        store: createRedisMonitorStore(context.redis),
        alerts: createSlackModqueueAlerts(outboxOf(context, config).send, config.alertChannel),
        health: healthReports(context),
    });
}

export async function alertOnPostDeletion(event: PostDeleteEvent, context: AppContext): Promise<void> {
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

/** What the app reads from a CommentDelete trigger event; Devvit's event type satisfies it. */
export type CommentDeleteEvent = Readonly<{ commentId: string }>;

/**
 * Reddit deleted a post or comment: its text leaves alerts still waiting for Slack, and stays out of any queued
 * later, whether or not a webhook is set. Logs rather than rejects, so a trigger goes on to its other work.
 */
export async function forgetDeletedContent(contentId: string, context: AppContext): Promise<void> {
    try {
        await forgetContent({ redis: context.redis, scheduler: context.scheduler }, contentId);
    } catch (error) {
        console.error("[deletions] Could not take a deleted post or comment out of queued alerts:", error);
    }
}

/** Delivers alerts an earlier drain left queued: the scheduled outbox job. Queued alerts wait while no webhook is set. */
export async function deliverQueuedAlerts(context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (alertsConfigured(config)) {
        await outboxOf(context, config).deliverQueued();
    }
}
