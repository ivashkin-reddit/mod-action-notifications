import type { Context, Form, ParagraphField, User } from "@devvit/public-api";
import {
    alertsConfigured,
    configOf,
    modActionPresentation,
    monitorThresholds,
    setUpModqueueMonitor,
} from "./composition.js";
import type { AppContext } from "./composition.js";
import { createRedisConditionStore, createRedisEventStore, dayOf, statusLines } from "./health/index.js";
import type { MonitorState, StatusInput, StatusLine } from "./health/index.js";
import {
    createSlackSimulationAlerts,
    simulateModAction,
    simulationRequestFromForm,
    slackChannelFromForm,
} from "./moderation/index.js";
import type { SimulateFormValues } from "./moderation/index.js";
import { createDevvitMonitorScheduler, isMonitoringEnabled, monitorJobStatus } from "./modqueue/index.js";
import type { MonitorJobStatus } from "./modqueue/index.js";
import type { AppConfig } from "./settings/index.js";
import { createWebhookSender, queueState, sendTestMessage } from "./slack/delivery.js";

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

function webhookState(config: AppConfig): StatusInput["webhook"] {
    if (config.slackWebhookUrlInvalid) {
        return "invalid";
    }
    return alertsConfigured(config) ? "set" : "missing";
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
        webhook: webhookState(config),
        monitor: monitorState(isMonitoringEnabled(monitorThresholds(config)), job),
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

/** The bot's status as a form of read-only lines, from the data botStatus gave ui.showForm. */
export function statusForm(data: Readonly<Record<string, unknown>>): Form {
    const lines = Array.isArray(data["lines"]) ? data["lines"].filter(isStatusLine) : [];
    return {
        title: "Bot Status",
        fields: lines.map(({ label, value }: StatusLine, index: number): ParagraphField => ({
            name: `status${String(index)}`,
            label,
            type: "paragraph",
            defaultValue: value,
            disabled: true,
        })),
        acceptLabel: "Close",
    };
}

/** How sending a test message went. */
type ConnectionTest = "delivered" | "not-configured" | "failed";

const CONNECTION_TEST_TOASTS: Readonly<
    Record<ConnectionTest, Readonly<{ text: string; appearance: "neutral" | "success" }>>
> = {
    "delivered": { text: "🧪 Test alert sent! Check your Slack channel and bot logs.", appearance: "success" },
    "not-configured": { text: "⚠️ No Slack webhook URL is set. Add one in the app's settings.", appearance: "neutral" },
    "failed": {
        text: "❌ Slack did not accept the test alert. Check the webhook URL and the bot logs.",
        appearance: "neutral",
    },
};

async function testSlackConnection(context: AppContext): Promise<ConnectionTest> {
    const config = await configOf(context);
    if (!alertsConfigured(config)) {
        return "not-configured";
    }
    return (await sendTestMessage(config.slackWebhookUrl)) ? "delivered" : "failed";
}

/** Sends a test message to Slack, and says how it went. */
export async function sendTestAlert(context: MenuContext): Promise<void> {
    context.ui.showToast(CONNECTION_TEST_TOASTS[await testSlackConnection(context)]);
}

/** Rejects when no webhook is set or Slack did not accept the alert. */
async function sendSimulatedModAction(values: SimulateFormValues, context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (!alertsConfigured(config)) {
        throw new Error("Slack webhook URL is not configured");
    }
    const channel = slackChannelFromForm(values);
    const presentation = modActionPresentation(config);
    await simulateModAction(
        simulationRequestFromForm(values),
        context.subredditName,
        // A moderator waits on the result, so the simulation goes straight to Slack, to the channel the form names.
        createSlackSimulationAlerts(createWebhookSender(config.slackWebhookUrl), {
            ...presentation,
            notificationChannel: channel === "" ? presentation.notificationChannel : channel,
        }),
    );
}

/** Sends the simulated action's alert straight to Slack, and says how it went. */
export async function sendSimulation(values: SimulateFormValues, context: MenuContext): Promise<void> {
    try {
        await sendSimulatedModAction(values, context);
        context.ui.showToast({ text: "✅ Simulation delivered to Slack!", appearance: "success" });
    } catch (error) {
        console.warn("[menu] Could not send the simulated mod action:", error);
        context.ui.showToast({ text: "❌ Could not send simulation. Check logs.", appearance: "neutral" });
    }
}

/** Sets up the monitor from the menu, and says how it went. */
export async function setUpFromMenu(context: MenuContext): Promise<void> {
    try {
        const result = await setUpModqueueMonitor(context);
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
