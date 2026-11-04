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
    openRedditModqueue,
    setupMonitoring,
} from "./modqueue/index.js";
import type { ModqueueConfig, MonitoringSetup, MonitorJobStatus, MonitorThresholds } from "./modqueue/index.js";
import {
    alertOnUserDeletion,
    createRedisRememberedPosts,
    createSlackPostDeletionAlerts,
    postDeletionFromTriggerEvent,
    rememberPostScore,
    seenPostFromTriggerEvent,
} from "./postDeletion/index.js";
import type { PostChangeEvent, PostDeleteEvent, PostDeletionConfig } from "./postDeletion/index.js";
import { createConfigLoader } from "./settings/index.js";
import type { AppConfig } from "./settings/index.js";
import { createWebhookSender, sendTestMessage } from "./slack/index.js";

/**
 * The composition root's wiring: for each thing a Devvit handler does, read the settings and build the capability's
 * adapters from that handler's context. main.ts registers the handlers.
 */

/** The Devvit APIs the app calls. Trigger, scheduler, menu and form contexts all satisfy this. */
export type AppContext = Readonly<{
    settings: Readonly<Pick<TriggerContext["settings"], "get">>;
    redis: Readonly<Pick<TriggerContext["redis"], "get" | "set" | "del" | "incrBy" | "expire">>;
    reddit: Readonly<
        Pick<TriggerContext["reddit"], "getCurrentSubreddit" | "getCurrentSubredditName" | "getModerationLog">
    >;
    scheduler: Readonly<Pick<TriggerContext["scheduler"], "runJob" | "cancelJob" | "listJobs">>;
    subredditName?: string | undefined;
}>;

export interface BotStatus {
    readonly monitoringEnabled: boolean;
    readonly webhookConfigured: boolean;
    readonly monitorJob: MonitorJobStatus;
}

// These live as long as the app process: the last settings read successfully, and the mod list last fetched.
const loadConfig = createConfigLoader();
const modListCache = createModListCache();

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
    return { queueSizeThreshold: config.modqueueThreshold, unmoderatedAgeHours: config.unmoderatedAgeHours };
}

function modqueueConfig(config: AppConfig): ModqueueConfig {
    return { ...monitorThresholds(config), alertsConfigured: alertsConfigured(config) };
}

function postDeletionConfig(config: AppConfig): PostDeletionConfig {
    return { alertsConfigured: alertsConfigured(config), upvoteThreshold: config.postDeletionUpvoteThreshold };
}

function modActionAlerts(config: AppConfig): ReturnType<typeof createSlackModActionAlerts> {
    return createSlackModActionAlerts(createWebhookSender(config.slackWebhookUrl), {
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
    const config = await loadConfig(context.settings);
    await notifyModAction(modActionFromTriggerEvent(event), moderationConfig(config), {
        records: createRedisModerationRecords(context.redis),
        lookups: createRedditModerationLookups(context.reddit, modListCache),
        alerts: modActionAlerts(config),
    });
}

export async function sendSimulatedModAction(values: SimulateFormValues, context: AppContext): Promise<void> {
    const config = await loadConfig(context.settings);
    await simulateModAction(
        simulationRequestFromForm(values),
        { alertsConfigured: alertsConfigured(config), subredditName: context.subredditName },
        modActionAlerts(config),
    );
}

export async function setUpModqueueMonitor(context: AppContext): Promise<MonitoringSetup> {
    const config = await loadConfig(context.settings);
    return await setupMonitoring(monitorThresholds(config), monitorJobPorts(context));
}

export async function runModqueueMonitor(context: AppContext): Promise<void> {
    const config = await loadConfig(context.settings);
    await checkModqueue(modqueueConfig(config), {
        openModqueue: async (): ReturnType<typeof openRedditModqueue> => await openRedditModqueue(context.reddit),
        store: createRedisMonitorStore(context.redis),
        alerts: createSlackModqueueAlerts(createWebhookSender(config.slackWebhookUrl), config.alertChannel),
    });
}

export async function botStatus(context: AppContext): Promise<BotStatus> {
    const config = await loadConfig(context.settings);
    return {
        monitoringEnabled: isMonitoringEnabled(monitorThresholds(config)),
        webhookConfigured: alertsConfigured(config),
        monitorJob: await monitorJobStatus(monitorJobPorts(context)),
    };
}

export async function testSlackConnection(context: AppContext): Promise<void> {
    const config = await loadConfig(context.settings);
    await sendTestMessage(config.slackWebhookUrl);
}

export async function rememberPost(event: PostChangeEvent, context: AppContext): Promise<void> {
    const config = await loadConfig(context.settings);
    await rememberPostScore(
        postDeletionConfig(config),
        seenPostFromTriggerEvent(event),
        createRedisRememberedPosts(context.redis),
    );
}

export async function alertOnPostDeletion(event: PostDeleteEvent, context: AppContext): Promise<void> {
    const config = await loadConfig(context.settings);
    await alertOnUserDeletion(postDeletionConfig(config), postDeletionFromTriggerEvent(event), {
        posts: createRedisRememberedPosts(context.redis),
        alerts: createSlackPostDeletionAlerts(createWebhookSender(config.slackWebhookUrl), config.alertChannel),
    });
}
