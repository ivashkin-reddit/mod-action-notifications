import {
    actionNameOf,
    alertsConfigured,
    configOf,
    healthReports,
    modmailPorts,
    monitorJobPorts,
    monitorThresholds,
    monitorWanted,
    outboxOf,
    slackSendersOf,
} from "./composition.js";
import type { AppContext } from "./composition.js";
import {
    createDevvitSummaryScheduler,
    createRedisConditionStore,
    createRedisEventStore,
    createSlackSummary,
    sendDailySummary,
    setUpSummary,
    yesterdayOf,
} from "./health/index.js";
import { checkWaitingModmail } from "./modmail/index.js";
import {
    checkModqueue,
    createRedisMonitorStore,
    createSlackModqueueAlerts,
    openRedditQueues,
    setupMonitoring,
} from "./modqueue/index.js";
import type { ModerationQueues, MonitoringSetup } from "./modqueue/index.js";
import { continuationStarted } from "./slack/delivery.js";
import {
    createDevvitDigestScheduler,
    createRedisStatisticsStore,
    createRedisWaitingStore,
    createSlackDigest,
    pruneWaiting,
    sendWeeklyDigest,
    setUpDigest,
} from "./statistics/index.js";

/**
 * The composition root's scheduled jobs: setting them up, and what each does when the scheduler runs it. main.ts
 * registers them; composition.ts builds what they share with the triggers.
 */

/**
 * Sets up the scheduled jobs: the monitor's while any of its thresholds or the modmail wait is above 0, logging which, then the daily
 * summary's, always, as it reads its setting when it runs. Returns the monitor's setup; a summary job that cannot
 * be scheduled is logged, and the next setup schedules it.
 */
export async function setUpScheduledJobs(context: AppContext): Promise<MonitoringSetup> {
    const config = await configOf(context);
    try {
        const setup = await setupMonitoring(monitorWanted(config), monitorJobPorts(context));
        console.info(
            setup.enabled
                ? "[setup] The modqueue monitor is on"
                : "[setup] The modqueue monitor is off: all its thresholds are 0",
        );
        return setup;
    } finally {
        // Set up whether or not the monitor's setup failed, which the caller logs.
        await setUpSummary(createDevvitSummaryScheduler(context.scheduler)).catch((error: unknown): void => {
            console.warn("[setup] Could not schedule the daily summary:", error);
        });
        await setUpDigest(createDevvitDigestScheduler(context.scheduler)).catch((error: unknown): void => {
            console.warn("[setup] Could not schedule the weekly statistics:", error);
        });
    }
}

/**
 * One run of the monitor job: the modqueue's checks, then modmail waiting for a reply. Each reports its own failure
 * to the health log, so modmail that cannot be read leaves the modqueue's alerts, and its health, alone.
 */
export async function runModqueueMonitor(context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (!alertsConfigured(config)) {
        return;
    }
    await checkModqueue(monitorThresholds(config), {
        openQueues: async (): Promise<ModerationQueues> => await openRedditQueues(context.reddit),
        store: createRedisMonitorStore(context.redis),
        alerts: createSlackModqueueAlerts(slackSendersOf(context, config).alerts),
        health: healthReports(context),
    });
    await checkWaitingModmail(config.modmailWaitHours, Date.now(), modmailPorts(context, config));
}

/**
 * Sends the summary of the day before, the scheduled job, when the setting is on and Slack is set up. Logs, and
 * resolves, when Redis fails.
 */
export async function sendSummary(context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (!config.dailySummary || !alertsConfigured(config)) {
        return;
    }
    try {
        await sendDailySummary(
            {
                events: createRedisEventStore(context.redis),
                conditions: createRedisConditionStore(context.redis),
                send: createSlackSummary(slackSendersOf(context, config).notifications),
            },
            yesterdayOf(Date.now()),
        );
    } catch (error) {
        console.error("[health] Could not send the daily summary:", error);
    }
}

/**
 * The weekly statistics job: forgets what has waited for a moderator over a week, whatever the setting, then sends
 * the team's statistics for the week before when the setting is on and Slack is set up. Logs, and resolves, when
 * Redis fails.
 */
export async function sendWeeklyStatistics(context: AppContext): Promise<void> {
    await pruneWaiting(createRedisWaitingStore(context.redis), Date.now()).catch((error: unknown): void => {
        console.warn("[statistics] Could not forget what waited over a week:", error);
    });
    const config = await configOf(context);
    if (!config.weeklyStatistics || !alertsConfigured(config)) {
        return;
    }
    try {
        await sendWeeklyDigest(
            {
                store: createRedisStatisticsStore(context.redis),
                send: createSlackDigest(slackSendersOf(context, config).notifications, actionNameOf),
            },
            Date.now(),
        );
    } catch (error) {
        console.error("[statistics] Could not send the weekly statistics:", error);
    }
}

/**
 * Delivers alerts an earlier drain left queued: the scheduled outbox job. Queued alerts wait while Slack is not set
 * up. Logs, and resolves, when Redis fails: the alerts wait for the next drain.
 */
export async function deliverQueuedAlerts(context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (!alertsConfigured(config)) {
        // This run has started, so a drain scheduled once Slack is set up again, as Connect Slack schedules one, is
        // not taken as covered by it.
        await continuationStarted(context);
        return;
    }
    try {
        await outboxOf(context, config).deliverQueued();
    } catch (error) {
        console.error("[outbox] Could not deliver the queued alerts; they wait for the next drain:", error);
    }
}
