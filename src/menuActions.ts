import type { Context, User } from "@devvit/public-api";
import {
    alertsConfigured,
    configOf,
    modActionPresentation,
    monitorThresholds,
    setUpModqueueMonitor,
} from "./composition.js";
import type { AppContext } from "./composition.js";
import {
    createSlackSimulationAlerts,
    simulateModAction,
    simulationRequestFromForm,
    slackChannelFromForm,
} from "./moderation/index.js";
import type { SimulateFormValues } from "./moderation/index.js";
import { createDevvitMonitorScheduler, isMonitoringEnabled, monitorJobStatus } from "./modqueue/index.js";
import type { MonitorJobStatus } from "./modqueue/index.js";
import { createWebhookSender, sendTestMessage } from "./slack/delivery.js";

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

function describeMonitorJob(status: MonitorJobStatus): string {
    switch (status.state) {
        case "not-scheduled": {
            return "Modqueue Monitor: Not scheduled";
        }
        case "active": {
            return status.cron === undefined
                ? "Modqueue Monitor: Active"
                : `Modqueue Monitor: Active (cron ${status.cron})`;
        }
        case "unknown": {
            return "Modqueue Monitor: Unknown";
        }
    }
}

/** Shows the bot's status as a toast. */
export async function showBotStatus(context: MenuContext): Promise<void> {
    const config = await configOf(context);
    const monitorJob = await monitorJobStatus(createDevvitMonitorScheduler(context.scheduler));
    const text = [
        `Modqueue Monitoring: ${isMonitoringEnabled(monitorThresholds(config)) ? "ON" : "OFF"}`,
        `Slack Webhook: ${alertsConfigured(config) ? "Configured" : "Missing"}`,
        describeMonitorJob(monitorJob),
    ].join(" • ");
    context.ui.showToast({ text, appearance: "neutral" });
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
