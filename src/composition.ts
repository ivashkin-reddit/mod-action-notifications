import type { TriggerContext } from "@devvit/public-api";
import {
    createModListCache,
    createRedditModerationLookups,
    createRedisModerationRecords,
    createSlackModActionAlerts,
    modActionFromTriggerEvent,
    notifyModAction,
    simulateModAction,
    simulationRequestFromForm,
} from "./moderation/index.js";
import type { ModActionEvent, ModerationConfig, SimulateFormValues } from "./moderation/index.js";
import {
    checkModqueue,
    createDevvitMonitorScheduler,
    createRedisMonitorStore,
    createSlackModqueueAlerts,
    isMonitoringEnabled,
    monitorJobStatus,
    openRedditQueues,
    setupMonitoring,
} from "./modqueue/index.js";
import type { ModqueueConfig, MonitoringSetup, MonitorJobStatus, MonitorThresholds } from "./modqueue/index.js";
import {
    alertOnUserDeletion,
    createRedditPostLookup,
    createSlackPostDeletionAlerts,
    postDeletionFromTriggerEvent,
} from "./postDeletion/index.js";
import type { PostDeleteEvent, PostDeletionConfig } from "./postDeletion/index.js";
import { createConfigLoader } from "./settings/index.js";
import type { AppConfig } from "./settings/index.js";
import { createSlackOutbox, createWebhookSender, sendTestMessage } from "./slack/index.js";
import type { SlackOutbox, SlackSender } from "./slack/index.js";

/**
 * The composition root's wiring: for each thing a Devvit handler does, read the settings and build the capability's
 * adapters from that handler's context. main.ts registers the handlers.
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
    subredditName?: string | undefined;
}>;

export interface BotStatus {
    readonly monitoringEnabled: boolean;
    readonly webhookConfigured: boolean;
    readonly monitorJob: MonitorJobStatus;
}

// These live as long as the app process, which can serve several installations: each installation's last settings
// read successfully, and the mod list last fetched (for its subreddit).
const loadConfig = createConfigLoader();
const modListCache = createModListCache();

async function configOf(context: AppContext): Promise<AppConfig> {
    return await loadConfig(context.settings, context.subredditId);
}

function alertsConfigured(config: AppConfig): boolean {
    return config.slackWebhookUrl !== "";
}

function moderationConfig(config: AppConfig): ModerationConfig {
    return {
        alertsConfigured: alertsConfigured(config),
        enabledActions: config.enabledActions,
        excludedModerators: config.excludedModerators,
        flagUnknownModerators: config.flagUnknownModerators,
        enableAutoModAlerts: config.enableAutoModAlerts,
    };
}

function monitorThresholds(config: AppConfig): MonitorThresholds {
    return {
        queueSizeThreshold: config.modqueueThreshold,
        unmoderatedAgeHours: config.unmoderatedAgeHours,
        reportedAgeHours: config.reportedContentAgeHours,
    };
}

function modqueueConfig(config: AppConfig): ModqueueConfig {
    return { ...monitorThresholds(config), alertsConfigured: alertsConfigured(config) };
}

function postDeletionConfig(config: AppConfig): PostDeletionConfig {
    return { alertsConfigured: alertsConfigured(config), upvoteThreshold: config.postDeletionUpvoteThreshold };
}

/** The installation's Slack outbox, through which every alert goes. */
function outboxOf(context: AppContext, config: AppConfig): SlackOutbox {
    return createSlackOutbox({
        webhookUrl: config.slackWebhookUrl,
        redis: context.redis,
        scheduler: context.scheduler,
    });
}

function modActionAlerts(send: SlackSender, config: AppConfig): ReturnType<typeof createSlackModActionAlerts> {
    return createSlackModActionAlerts(send, {
        includeModNote: config.includeModNote,
        notificationChannel: config.notificationChannel,
        alertChannel: config.alertChannel,
    });
}

function monitorJobPorts(context: AppContext): Parameters<typeof setupMonitoring>[1] {
    return {
        store: createRedisMonitorStore(context.redis),
        scheduler: createDevvitMonitorScheduler(context.scheduler),
    };
}

export async function alertOnModAction(event: ModActionEvent, context: AppContext): Promise<void> {
    const config = await configOf(context);
    await notifyModAction(modActionFromTriggerEvent(event), moderationConfig(config), {
        records: createRedisModerationRecords(context.redis),
        lookups: createRedditModerationLookups(context.reddit, modListCache),
        alerts: modActionAlerts(outboxOf(context, config).send, config),
    });
}

export async function sendSimulatedModAction(values: SimulateFormValues, context: AppContext): Promise<void> {
    const config = await configOf(context);
    await simulateModAction(
        simulationRequestFromForm(values),
        { alertsConfigured: alertsConfigured(config), subredditName: context.subredditName },
        // A moderator waits on the result, so the simulation goes straight to Slack.
        modActionAlerts(createWebhookSender(config.slackWebhookUrl), config),
    );
}

export async function setUpModqueueMonitor(context: AppContext): Promise<MonitoringSetup> {
    const config = await configOf(context);
    return await setupMonitoring(monitorThresholds(config), monitorJobPorts(context));
}

export async function runModqueueMonitor(context: AppContext): Promise<void> {
    const config = await configOf(context);
    await checkModqueue(modqueueConfig(config), {
        openQueues: async (): ReturnType<typeof openRedditQueues> => await openRedditQueues(context.reddit),
        store: createRedisMonitorStore(context.redis),
        alerts: createSlackModqueueAlerts(outboxOf(context, config).send, config.alertChannel),
    });
}

export async function botStatus(context: AppContext): Promise<BotStatus> {
    const config = await configOf(context);
    return {
        monitoringEnabled: isMonitoringEnabled(monitorThresholds(config)),
        webhookConfigured: alertsConfigured(config),
        monitorJob: await monitorJobStatus(monitorJobPorts(context)),
    };
}

/** How sending a test message went. */
export type ConnectionTest = "delivered" | "not-configured" | "failed";

export async function testSlackConnection(context: AppContext): Promise<ConnectionTest> {
    const config = await configOf(context);
    if (!alertsConfigured(config)) {
        return "not-configured";
    }
    return (await sendTestMessage(config.slackWebhookUrl)) ? "delivered" : "failed";
}

export async function alertOnPostDeletion(event: PostDeleteEvent, context: AppContext): Promise<void> {
    const config = await configOf(context);
    await alertOnUserDeletion(postDeletionConfig(config), postDeletionFromTriggerEvent(event), {
        posts: createRedditPostLookup(context.reddit),
        alerts: createSlackPostDeletionAlerts(outboxOf(context, config).send, config.alertChannel),
    });
}

/** Delivers alerts an earlier drain left queued: the scheduled outbox job. Queued alerts wait while no webhook is set. */
export async function deliverQueuedAlerts(context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (alertsConfigured(config)) {
        await outboxOf(context, config).deliverQueued();
    }
}
