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
import type { Invocation } from "./meter.js";
import { actionName } from "./moderation/index.js";
import type { ModActionPresentation } from "./moderation/index.js";
import {
    createRedditModmail,
    createRedisModmailClaims,
    createSlackModmailAlerts,
    isWaitingAlertOn,
} from "./modmail/index.js";
import type { ModmailHealth, ModmailPorts, ModmailReddit } from "./modmail/index.js";
import { createDevvitMonitorScheduler, createRedisMonitorStore, isMonitoringEnabled } from "./modqueue/index.js";
import type { MonitorHealth, MonitorJobPorts, MonitorThresholds } from "./modqueue/index.js";
import { createConfigLoader } from "./settings/index.js";
import type { AppConfig } from "./settings/index.js";
import { createSlackOutbox, readConnection } from "./slack/delivery.js";
import type { DeliveryHealth, SlackApi, SlackConnection, SlackFetch, SlackOutbox } from "./slack/delivery.js";

/**
 * The composition root's shared wiring: the settings, Slack's setup, the health log and the outbox, built from a
 * handler's context. triggers.ts, scheduledJobs.ts and menuActions.ts do what each handler does, and main.ts registers
 * them. Without a bot token and a channel, alerts have nowhere to go: the handlers that send them do nothing.
 */

/** The Devvit APIs the app calls. Trigger, scheduler, menu and form contexts all satisfy this. */
export type PlatformContext = Readonly<{
    settings: Readonly<Pick<TriggerContext["settings"], "get">>;
    redis: Readonly<
        Pick<
            TriggerContext["redis"],
            | "get"
            | "mGet"
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
            | "hLen"
            | "hScan"
            | "zCard"
        >
    >;
    reddit: Readonly<
        Pick<
            TriggerContext["reddit"],
            | "getCurrentSubreddit"
            | "getCurrentSubredditName"
            | "getModerationLog"
            | "getModNotes"
            | "getPostById"
            | "getWikiPageRevisions"
            | "getWikiPage"
        >
    > &
        NoticeReddit &
        ModmailReddit;
    scheduler: Readonly<Pick<TriggerContext["scheduler"], "runJob" | "cancelJob" | "listJobs">>;
    /** Identifies the installation: one app process can serve several. */
    subredditId: string;
    /** The version of the app that is running. */
    appVersion: string;
    subredditName?: string | undefined;
}>;

/**
 * What a handler works with: Devvit's APIs, each call counted for the invocation's completion line, the fetch Slack is
 * called with, likewise counted, and the invocation itself. main.ts makes one for each invocation (invocations.ts).
 */
export type AppContext = PlatformContext & Readonly<{ fetch: SlackFetch; invocation: Invocation }>;

// Each installation's last settings read successfully, for as long as the app process lives: it can serve several.
const loadConfig = createConfigLoader();

/** The installation's settings, as last read successfully. */
export async function settingsOf(context: AppContext): Promise<AppConfig> {
    const config = await loadConfig(context.settings, context.subredditId);
    context.invocation.noteDebug(config.debugLogging);
    return config;
}

/**
 * The installation's settings with its connection to Slack: the bot token its moderators connected ('' for none), and
 * the workspace's name.
 */
export type Installation = AppConfig & Readonly<{ slackBotToken: string; slackWorkspace: string }>;

/** The settings with the Slack connection the moderators made, if any. */
export function withConnection(config: AppConfig, connection: SlackConnection | undefined): Installation {
    return { ...config, slackBotToken: connection?.token ?? "", slackWorkspace: connection?.team ?? "" };
}

/** The installation's settings, and the Slack connection its moderators made. Rejects when Redis fails. */
export async function configOf(context: AppContext): Promise<Installation> {
    return withConnection(await settingsOf(context), await readConnection(context.redis));
}

/** How the installation calls Slack: with the bot token connected, through the invocation's fetch. */
export function slackApiOf(context: AppContext, config: Installation): SlackApi {
    return { token: config.slackBotToken, fetch: context.fetch };
}

/** Whether Slack is set up: what is missing, if anything, for alerts to be sent. */
export type SlackSetup = "set-up" | "token-missing" | "channel-missing";

export function slackSetup(config: Installation): SlackSetup {
    if (config.slackBotToken === "") {
        return "token-missing";
    }
    return config.notificationChannel === "" ? "channel-missing" : "set-up";
}

export function alertsConfigured(config: Installation): boolean {
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
export async function slackReady(context: AppContext, config: Installation): Promise<boolean> {
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

/** Whether the monitor job runs: while any of the modqueue's thresholds, or the modmail wait, is on. */
export function monitorWanted(config: AppConfig): boolean {
    return isMonitoringEnabled(monitorThresholds(config)) || isWaitingAlertOn(config.modmailWaitHours);
}

/** The installation's health log, where the outbox, the monitor and the modmail checks report lasting problems. */
export function healthReports(context: AppContext): DeliveryHealth & MonitorHealth & ModmailHealth {
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
export function outboxOf(context: AppContext, config: Installation): SlackOutbox {
    const outbox = createSlackOutbox({
        api: slackApiOf(context, config),
        retentionDays: config.slackRetentionDays,
        redis: context.redis,
        scheduler: context.scheduler,
        health: healthReports(context),
    });
    return {
        ...outbox,
        send: async (...alert: Readonly<Parameters<SlackOutbox["send"]>>): Promise<void> => {
            context.invocation.noteAlert();
            await outbox.send(...alert);
        },
    };
}

/** The installation's modmail, its alert claims, and where its alerts and problems go. */
export function modmailPorts(context: AppContext, config: Installation): ModmailPorts {
    return {
        reader: createRedditModmail(context.reddit, context.subredditName),
        claims: createRedisModmailClaims(context.redis),
        alerts: createSlackModmailAlerts(outboxOf(context, config).send, config.alertChannel),
        health: healthReports(context),
    };
}

/** How statistics name an action type, e.g. "Post Removed", as alerts do. */
export function actionNameOf(type: string): string {
    return actionName(type, false);
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
