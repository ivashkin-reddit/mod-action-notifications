import type { TriggerContext } from '@devvit/public-api';
import {
  createModListCache,
  createRedditModerationLookups,
  createRedisModerationRecords,
  createSlackModActionAlerts,
  modActionFromTriggerEvent,
  notifyModAction,
  simulateModAction,
  simulationRequestFromForm,
  type ModerationConfig,
} from './moderation';
import {
  checkModqueue,
  createDevvitMonitorScheduler,
  createRedisMonitorStore,
  createSlackModqueueAlerts,
  isMonitoringEnabled,
  monitorJobStatus,
  openRedditModqueue,
  setupMonitoring,
  type MonitorJobStatus,
  type MonitorThresholds,
} from './modqueue';
import {
  alertOnUserDeletion,
  createRedisRememberedPosts,
  createSlackPostDeletionAlerts,
  postDeletionFromTriggerEvent,
  rememberPostScore,
  seenPostFromTriggerEvent,
  type PostDeletionConfig,
} from './postDeletion';
import { createConfigLoader, type AppConfig } from './settings';
import { createWebhookSender, sendTestMessage } from './slack';

/**
 * The composition root's wiring: for each thing a Devvit handler does, read the settings and build the
 * capability's adapters from that handler's context. main.ts registers the handlers.
 */

/** The parts of a Devvit context the app uses; trigger, scheduler, menu and form contexts all have them. */
export type AppContext = Pick<TriggerContext, 'settings' | 'redis' | 'reddit' | 'scheduler' | 'subredditName'>;

// These live as long as the app process: the last settings read successfully, and the mod list last fetched.
const loadConfig = createConfigLoader();
const modListCache = createModListCache();

function moderationConfig(config: AppConfig): ModerationConfig {
  return {
    alertsConfigured: Boolean(config.slackWebhookUrl),
    enabledActions: config.enabledActions,
    excludedModerators: config.excludedModerators,
    flagUnknownModerators: config.flagUnknownModerators,
    enableAutoModAlerts: config.enableAutoModAlerts,
  };
}

function modActionAlerts(config: AppConfig) {
  return createSlackModActionAlerts(createWebhookSender(config.slackWebhookUrl), {
    includeModNote: config.includeModNote,
    notificationChannel: config.notificationChannel,
    alertChannel: config.alertChannel,
  });
}

export async function alertOnModAction(event: unknown, context: AppContext): Promise<void> {
  const config = await loadConfig(context.settings);
  await notifyModAction(modActionFromTriggerEvent(event), moderationConfig(config), {
    records: createRedisModerationRecords(context.redis),
    lookups: createRedditModerationLookups(context.reddit, modListCache),
    alerts: modActionAlerts(config),
  });
}

export async function sendSimulatedModAction(values: Record<string, unknown>, context: AppContext): Promise<void> {
  const config = await loadConfig(context.settings);
  await simulateModAction(
    simulationRequestFromForm(values),
    { alertsConfigured: Boolean(config.slackWebhookUrl) },
    context.subredditName,
    modActionAlerts(config),
  );
}

function monitorThresholds(config: AppConfig): MonitorThresholds {
  return { queueSizeThreshold: config.modqueueThreshold, unmoderatedAgeHours: config.unmoderatedAgeHours };
}

function monitorJobPorts(context: AppContext) {
  return { store: createRedisMonitorStore(context.redis), scheduler: createDevvitMonitorScheduler(context.scheduler) };
}

function postDeletionConfig(config: AppConfig): PostDeletionConfig {
  return { alertsConfigured: Boolean(config.slackWebhookUrl), upvoteThreshold: config.postDeletionUpvoteThreshold };
}

export async function setUpModqueueMonitor(context: AppContext): Promise<{ enabled: boolean; jobId?: string }> {
  const config = await loadConfig(context.settings);
  return setupMonitoring(monitorThresholds(config), monitorJobPorts(context));
}

export async function runModqueueMonitor(context: AppContext): Promise<void> {
  const config = await loadConfig(context.settings);
  await checkModqueue(
    { ...monitorThresholds(config), alertsConfigured: Boolean(config.slackWebhookUrl) },
    {
      openModqueue: () => openRedditModqueue(context.reddit),
      store: createRedisMonitorStore(context.redis),
      alerts: createSlackModqueueAlerts(createWebhookSender(config.slackWebhookUrl), config.alertChannel),
    },
  );
}

export interface BotStatus {
  monitoringEnabled: boolean;
  webhookConfigured: boolean;
  monitorJob: MonitorJobStatus;
}

export async function botStatus(context: AppContext): Promise<BotStatus> {
  const config = await loadConfig(context.settings);
  return {
    monitoringEnabled: isMonitoringEnabled(monitorThresholds(config)),
    webhookConfigured: Boolean(config.slackWebhookUrl),
    monitorJob: await monitorJobStatus(monitorJobPorts(context)),
  };
}

export async function testSlackConnection(context: AppContext): Promise<void> {
  const config = await loadConfig(context.settings);
  await sendTestMessage(config.slackWebhookUrl);
}

export async function rememberPost(event: Record<string, unknown>, context: AppContext): Promise<void> {
  const config = await loadConfig(context.settings);
  await rememberPostScore(postDeletionConfig(config), seenPostFromTriggerEvent(event), createRedisRememberedPosts(context.redis));
}

export async function alertOnPostDeletion(event: Record<string, unknown>, context: AppContext): Promise<void> {
  const config = await loadConfig(context.settings);
  await alertOnUserDeletion(postDeletionConfig(config), postDeletionFromTriggerEvent(event), {
    posts: createRedisRememberedPosts(context.redis),
    alerts: createSlackPostDeletionAlerts(createWebhookSender(config.slackWebhookUrl), config.alertChannel),
  });
}
