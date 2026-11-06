import type { TriggerContext } from "@devvit/public-api";
import {
    clearCondition,
    createModmailNotices,
    createRedisConditionStore,
    createRedisEventStore,
    noteEvent,
    raiseCondition,
} from "./health/index.js";
import type { Condition, ConditionPorts, HealthEvent, NoticeReddit } from "./health/index.js";
import type { ModActionPresentation } from "./moderation/index.js";
import { createDevvitMonitorScheduler, createRedisMonitorStore } from "./modqueue/index.js";
import type { MonitorHealth, MonitorJobPorts, MonitorThresholds } from "./modqueue/index.js";
import { createConfigLoader } from "./settings/index.js";
import type { AppConfig } from "./settings/index.js";
import { createSlackOutbox } from "./slack/delivery.js";
import type { DeliveryHealth, SlackOutbox } from "./slack/delivery.js";

/**
 * The composition root's shared wiring: the settings, Slack's setup, the health log and the outbox, built from a
 * handler's context. triggers.ts, scheduledJobs.ts and menuActions.ts do what each handler does, and main.ts registers
 * them. Without a bot token and a channel, alerts have nowhere to go: the handlers that send them do nothing.
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
            | "zIncrBy"
            | "zRange"
            | "zScore"
            | "hSetNX"
            | "hGet"
            | "hGetAll"
            | "hSet"
            | "hIncrBy"
            | "hDel"
            | "zCard"
        >
    >;
    reddit: Readonly<
        Pick<
            TriggerContext["reddit"],
            "getCurrentSubreddit" | "getCurrentSubredditName" | "getModerationLog" | "getModNotes" | "getPostById"
        >
    > &
        NoticeReddit;
    scheduler: Readonly<Pick<TriggerContext["scheduler"], "runJob" | "cancelJob" | "listJobs">>;
    /** Identifies the installation: one app process can serve several. */
    subredditId: string;
    /** The version of the app that is running. */
    appVersion: string;
    subredditName?: string | undefined;
}>;

// Each installation's last settings read successfully, for as long as the app process lives: it can serve several.
const loadConfig = createConfigLoader();

export async function configOf(context: AppContext): Promise<AppConfig> {
    return await loadConfig(context.settings, context.subredditId);
}

/** Whether Slack is set up: what is missing, if anything, for alerts to be sent. */
export type SlackSetup = "set-up" | "token-missing" | "channel-missing";

export function slackSetup(config: AppConfig): SlackSetup {
    if (config.slackBotToken === "") {
        return "token-missing";
    }
    return config.notificationChannel === "" ? "channel-missing" : "set-up";
}

export function alertsConfigured(config: AppConfig): boolean {
    return slackSetup(config) === "set-up";
}

/** Where the installation's health conditions are kept, and where moderators are told of them. */
function conditionPorts(context: AppContext): ConditionPorts {
    return {
        store: createRedisConditionStore(context.redis),
        notices: createModmailNotices(context.reddit, context.subredditId),
    };
}

/** Whether alerts can be sent, noting for the health log whether the bot token or the channel is missing. */
export async function slackReady(context: AppContext, config: AppConfig): Promise<boolean> {
    const conditions = conditionPorts(context);
    const setup = slackSetup(config);
    await (setup === "token-missing"
        ? raiseCondition(conditions, "token-missing", "")
        : clearCondition(conditions, "token-missing"));
    await (setup === "channel-missing"
        ? raiseCondition(conditions, "channel-missing", "")
        : clearCondition(conditions, "channel-missing"));
    return setup === "set-up";
}

export function monitorThresholds(config: AppConfig): MonitorThresholds {
    return {
        queueSizeThreshold: config.modqueueThreshold,
        unmoderatedAgeHours: config.unmoderatedAgeHours,
        reportedAgeHours: config.reportedContentAgeHours,
        spamQueueThreshold: config.spamQueueThreshold,
        editedQueueThreshold: config.editedQueueThreshold,
    };
}

/** The installation's health log, where the outbox and the monitor report lasting problems. */
export function healthReports(context: AppContext): DeliveryHealth & MonitorHealth {
    const conditions = conditionPorts(context);
    return {
        raise: async (condition: Condition, detail: string): Promise<void> => {
            await raiseCondition(conditions, condition, detail);
        },
        clear: async (condition: Condition): Promise<void> => {
            await clearCondition(conditions, condition);
        },
        note: async (event: HealthEvent, count: number): Promise<void> => {
            await noteEvent(createRedisEventStore(context.redis), event, count);
        },
    };
}

/** The installation's Slack outbox, through which every alert goes. */
export function outboxOf(context: AppContext, config: AppConfig): SlackOutbox {
    return createSlackOutbox({
        token: config.slackBotToken,
        retentionDays: config.slackRetentionDays,
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
        securityAlerts: config.securityAlerts,
    };
}

export function monitorJobPorts(context: AppContext): MonitorJobPorts {
    return {
        store: createRedisMonitorStore(context.redis),
        scheduler: createDevvitMonitorScheduler(context.scheduler),
    };
}
