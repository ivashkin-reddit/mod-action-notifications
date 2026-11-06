import type { Context, Form, ParagraphField, User } from "@devvit/public-api";
import { actionNameOf, configOf, modActionPresentation, monitorWanted, slackSetup } from "./composition.js";
import type { AppContext, SlackSetup } from "./composition.js";
import { createRedisConditionStore, createRedisEventStore, dayOf, statusLines } from "./health/index.js";
import type { MonitorState, StatusLine } from "./health/index.js";
import {
    createSlackSimulationAlerts,
    simulateModAction,
    simulationRequestFromForm,
    slackChannelFromForm,
} from "./moderation/index.js";
import type { SimulateFormValues } from "./moderation/index.js";
import { createDevvitMonitorScheduler, monitorJobStatus } from "./modqueue/index.js";
import type { MonitorJobStatus } from "./modqueue/index.js";
import { setUpScheduledJobs } from "./scheduledJobs.js";
import type { AppConfig } from "./settings/index.js";
import { createDirectSender, queueState, sendTestMessage } from "./slack/delivery.js";
import { countOf, createRedisStatisticsStore, dayRange, reportFor, reportLines } from "./statistics/index.js";
import type { ReportLine, TeamReport } from "./statistics/index.js";

/**
 * The composition root's menu actions: what each menu item and form does for the moderator who invoked it, and the
 * toasts that tell them how it went. main.ts registers the menu items and forms.
 */

/** What the moderator check reads of the user who pressed a menu item or submitted a form. */
export type InvokerContext = Readonly<{
    reddit: Readonly<{
        getCurrentUser: () => Promise<Readonly<Pick<User, "getModPermissionsForSubreddit">> | undefined>;
        getCurrentSubredditName: () => Promise<string>;
    }>;
    subredditName?: string | undefined;
}>;

/** The Devvit APIs a menu item or form handler calls. */
export type MenuContext = AppContext &
    InvokerContext &
    Readonly<{ ui: Readonly<Pick<Context["ui"], "showForm" | "showToast">> }>;

const MODERATORS_ONLY_TOAST: Readonly<{ text: string; appearance: "neutral" }> = {
    text: "🔒 Only this subreddit's moderators can use this.",
    appearance: "neutral",
};

/**
 * Whether the user who pressed a menu item or submitted a form moderates the subreddit: false for a logged-out user.
 * Devvit only hides a moderator menu item from other users; it calls the handler for whoever invokes it, and shows
 * a form to whoever that handler shows it to. Rejects when Reddit cannot say.
 */
async function invokedByModerator(context: InvokerContext): Promise<boolean> {
    const user = await context.reddit.getCurrentUser();
    if (user === undefined) {
        return false;
    }
    const subredditName =
        context.subredditName === undefined || context.subredditName === ""
            ? await context.reddit.getCurrentSubredditName()
            : context.subredditName;
    return (await user.getModPermissionsForSubreddit(subredditName)).length > 0;
}

/**
 * Runs `action` for a moderator of the subreddit, and tells anyone else it is not for them. Devvit shows moderator
 * menu items only to moderators but runs their handlers for whoever invokes them, so every menu item and form
 * checks for itself. When Reddit cannot say who the user moderates, the action is refused.
 */
export async function forModerators(context: MenuContext, action: () => Promise<void> | void): Promise<void> {
    const allowed = await invokedByModerator(context).catch((error: unknown): boolean => {
        console.warn("[menu] Could not check that the user moderates the subreddit, so refused them:", error);
        return false;
    });
    if (!allowed) {
        context.ui.showToast(MODERATORS_ONLY_TOAST);
        return;
    }
    await action();
}

function monitorState(enabled: boolean, job: MonitorJobStatus): MonitorState {
    switch (job.state) {
        case "not-scheduled": {
            return { enabled, job: "none" };
        }
        case "active": {
            return job.cron === undefined ? { enabled, job: "one-off" } : { enabled, job: "scheduled", cron: job.cron };
        }
        case "unknown": {
            return { enabled, job: "unknown" };
        }
    }
}

/** What the status shows when Redis cannot say: unknown, with the failure logged. */
function readFailed(error: unknown): undefined {
    console.warn("[menu] Could not read Redis for the bot status:", error);
    return undefined;
}

/**
 * What the bot's status form says, from the settings, the scheduler and Redis: the data ui.showForm passes to
 * statusForm, which Devvit requires to be plain JSON.
 */
export async function botStatus(context: MenuContext): Promise<{ lines: { label: string; value: string }[] }> {
    const config = await configOf(context);
    const job = await monitorJobStatus(createDevvitMonitorScheduler(context.scheduler));
    const events = createRedisEventStore(context.redis);
    const now = Date.now();
    const lines = statusLines({
        now,
        version: context.appVersion,
        slack: slackSetup(config),
        monitor: monitorState(monitorWanted(config), job),
        problems: await createRedisConditionStore(context.redis).inForce().catch(readFailed),
        queue: await queueState(context.redis).catch(readFailed),
        lastSeen: await events.lastSeen().catch(readFailed),
        today: await events.counts(dayOf(now)).catch(readFailed),
    });
    return { lines: lines.map(({ label, value }: StatusLine): { label: string; value: string } => ({ label, value })) };
}

function isStatusLine(value: unknown): value is StatusLine {
    return (
        typeof value === "object" &&
        value !== null &&
        "label" in value &&
        typeof value.label === "string" &&
        "value" in value &&
        typeof value.value === "string"
    );
}

/** Show Team Stats covers the last 7 days, today included. */
const WEEK_DAYS = 7;

/** A form titled `title` of read-only lines, from the data a menu item gave ui.showForm: `{ lines }`. */
export function readOnlyForm(title: string): (data: Readonly<Record<string, unknown>>) => Form {
    return (data: Readonly<Record<string, unknown>>): Form => {
        const lines = Array.isArray(data["lines"]) ? data["lines"].filter(isStatusLine) : [];
        return {
            title,
            fields: lines.map(({ label, value }: StatusLine, index: number): ParagraphField => ({
                name: `status${String(index)}`,
                label,
                type: "paragraph",
                defaultValue: value,
                disabled: true,
            })),
            acceptLabel: "Close",
        };
    };
}

/** The bot's status as a form of read-only lines, from the data botStatus gave ui.showForm. */
export const statusForm = readOnlyForm("Bot Status");

/** The team's reports for the last 7 days and for today; undefined, once the moderator is told, when unreadable. */
async function teamReports(
    context: MenuContext,
    now: number,
): Promise<Readonly<{ week: TeamReport; today: TeamReport }> | undefined> {
    const store = createRedisStatisticsStore(context.redis);
    try {
        return {
            week: await reportFor(store, dayRange(now, WEEK_DAYS, 0), now),
            today: await reportFor(store, dayRange(now, 1, 0), now),
        };
    } catch (error) {
        console.warn("[menu] Could not read the team's statistics:", error);
        context.ui.showToast({
            text: "❌ Could not read the team's statistics. Try again in a moment.",
            appearance: "neutral",
        });
        return undefined;
    }
}

/**
 * The team's statistics for the last 7 days, today included, as lines for a read-only form, with today's actions
 * last. They name no moderator. Undefined, once the moderator is told, when they cannot be read.
 */
export async function teamStats(
    context: MenuContext,
): Promise<{ lines: { label: string; value: string }[] } | undefined> {
    const reports = await teamReports(context, Date.now());
    if (reports === undefined) {
        return undefined;
    }
    const { week, today } = reports;
    const lines: readonly ReportLine[] = [
        ...reportLines(week, actionNameOf),
        { label: "Today", value: countOf(today.actions.total, "action") },
    ];
    return { lines: lines.map(({ label, value }: ReportLine): { label: string; value: string } => ({ label, value })) };
}

/** How sending a test message went, or what kept it from being sent. */
type ConnectionTest = "delivered" | Exclude<SlackSetup, "set-up"> | "failed";

const CONNECTION_TEST_TOASTS: Readonly<
    Record<ConnectionTest, Readonly<{ text: string; appearance: "neutral" | "success" }>>
> = {
    "delivered": { text: "🧪 Test alert sent! Check your Slack channel and bot logs.", appearance: "success" },
    "token-missing": { text: "⚠️ No Slack bot token is set. The app's developer sets it.", appearance: "neutral" },
    "channel-missing": {
        text: "⚠️ No Notification Channel is set. Set it in the app's settings.",
        appearance: "neutral",
    },
    "failed": {
        text: "❌ Slack did not accept the test alert. Check the Notification Channel, and that the Slack app is in it.",
        appearance: "neutral",
    },
};

async function testSlackConnection(context: AppContext): Promise<ConnectionTest> {
    const config = await configOf(context);
    const setup = slackSetup(config);
    if (setup !== "set-up") {
        return setup;
    }
    return (await sendTestMessage(config.slackBotToken, config.notificationChannel)) ? "delivered" : "failed";
}

/** Sends a test message to Slack, and says how it went. */
export async function sendTestAlert(context: MenuContext): Promise<void> {
    context.ui.showToast(CONNECTION_TEST_TOASTS[await testSlackConnection(context)]);
}

/**
 * The channel the form names, without its #: '' for none, so the alert goes where a real one would. Only the
 * configured channels may be named: the bot token is the app's, and reaches every channel the Slack app is in,
 * other subreddits' included. Undefined for any other channel.
 */
function simulationChannel(values: SimulateFormValues, config: AppConfig): string | undefined {
    const channel = slackChannelFromForm(values).replace(/^#+/u, "");
    return channel === "" || [config.notificationChannel, config.alertChannel].includes(channel) ? channel : undefined;
}

/** Sends the simulation; "channel-refused" when the form names a channel not configured. Rejects when Slack is not set up or did not accept the alert. */
async function sendSimulatedModAction(
    values: SimulateFormValues,
    context: AppContext,
): Promise<"sent" | "channel-refused"> {
    const config = await configOf(context);
    const setup = slackSetup(config);
    if (setup !== "set-up") {
        throw new Error(`Slack is not set up: ${setup}`);
    }
    const channel = simulationChannel(values, config);
    if (channel === undefined) {
        return "channel-refused";
    }
    const presentation = modActionPresentation(config);
    await simulateModAction(
        simulationRequestFromForm(values),
        context.subredditName,
        // A moderator waits on the result, so the simulation goes straight to Slack, to the channel the form names.
        createSlackSimulationAlerts(createDirectSender(config.slackBotToken), {
            ...presentation,
            notificationChannel: channel === "" ? presentation.notificationChannel : channel,
        }),
    );
    return "sent";
}

/** Sends the simulated action's alert straight to Slack, and says how it went. */
export async function sendSimulation(values: SimulateFormValues, context: MenuContext): Promise<void> {
    try {
        if ((await sendSimulatedModAction(values, context)) === "channel-refused") {
            console.warn("[menu] Refused a simulated mod action to a channel that is not configured");
            context.ui.showToast({
                text: "❌ The channel override must be your Notification Channel or Alert Channel.",
                appearance: "neutral",
            });
            return;
        }
        context.ui.showToast({ text: "✅ Simulation delivered to Slack!", appearance: "success" });
    } catch (error) {
        console.warn("[menu] Could not send the simulated mod action:", error);
        context.ui.showToast({ text: "❌ Could not send simulation. Check logs.", appearance: "neutral" });
    }
}

/** Sets up the monitor from the menu, and says how it went. */
export async function setUpFromMenu(context: MenuContext): Promise<void> {
    try {
        const result = await setUpScheduledJobs(context);
        context.ui.showToast(
            result.enabled
                ? {
                      text: `✅ Modqueue monitoring enabled (Job ID: ${result.jobId === undefined || result.jobId === "" ? "unknown" : result.jobId})`,
                      appearance: "success",
                  }
                : { text: "⚠️ Modqueue monitoring disabled (thresholds set to 0)", appearance: "neutral" },
        );
    } catch (error) {
        console.error("[setup] Could not set up the modqueue monitor:", error);
        context.ui.showToast({ text: "❌ Failed to setup modqueue monitoring", appearance: "neutral" });
    }
}
