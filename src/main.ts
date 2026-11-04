/**
 * The app's entry point and composition root: everything it registers with Devvit (settings, triggers, the
 * scheduler job, forms and menu items) and what moderators see from menus. composition.ts builds what each handler
 * needs; the capability modules do the work.
 */
import { Devvit } from "@devvit/public-api";
import type { Context } from "@devvit/public-api";
import {
    alertOnModAction,
    alertOnPostDeletion,
    botStatus,
    rememberPost,
    runModqueueMonitor,
    sendSimulatedModAction,
    setUpModqueueMonitor,
    testSlackConnection,
} from "./composition.js";
import type { AppContext, BotStatus } from "./composition.js";
import { simulateForm } from "./moderation/index.js";
import type { ModActionEvent, SimulateFormValues } from "./moderation/index.js";
import { MONITOR_JOB_NAME } from "./modqueue/index.js";
import type { MonitorJobStatus } from "./modqueue/index.js";
import type { PostChangeEvent, PostDeleteEvent } from "./postDeletion/index.js";
import { settingsDefinitions } from "./settings/index.js";

/** The Devvit APIs a menu item or form handler calls. */
type MenuContext = AppContext & Readonly<{ ui: Readonly<Pick<Context["ui"], "showForm" | "showToast">> }>;

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
        case "stale": {
            return "Modqueue Monitor: Stale reference";
        }
        case "unknown": {
            return "Modqueue Monitor: Unknown";
        }
        case "unavailable": {
            return "Job Status: Unavailable";
        }
    }
}

function describeStatus({ monitoringEnabled, webhookConfigured, monitorJob }: BotStatus): string {
    return [
        `Modqueue Monitoring: ${monitoringEnabled ? "ON" : "OFF"}`,
        `Slack Webhook: ${webhookConfigured ? "Configured" : "Missing"}`,
        describeMonitorJob(monitorJob),
    ].join(" • ");
}

// devvit.json grants these permissions; Devvit 0.15 takes them from there, not from here.
Devvit.configure({
    redditAPI: true,
    http: {
        domains: ["hooks.slack.com"],
    },
    redis: true,
});

Devvit.addSettings(settingsDefinitions);

// Triggers. devvit.json must list every trigger registered here.

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: async (_event: unknown, context: AppContext): Promise<void> => {
        try {
            await setUpModqueueMonitor(context);
        } catch (error) {
            console.error("Failed to auto-setup modqueue monitoring on install:", error);
        }
    },
});

Devvit.addTrigger({
    event: "AppUpgrade",
    onEvent: async (_event: unknown, context: AppContext): Promise<void> => {
        try {
            await setUpModqueueMonitor(context);
        } catch (error) {
            console.error("Failed to setup modqueue monitoring on upgrade:", error);
        }
    },
});

Devvit.addTrigger({
    event: "ModAction",
    onEvent: async (event: ModActionEvent, context: AppContext): Promise<void> => {
        await alertOnModAction(event, context);
    },
});

Devvit.addTrigger({
    event: "PostDelete",
    onEvent: async (event: PostDeleteEvent, context: AppContext): Promise<void> => {
        await alertOnPostDeletion(event, context);
    },
});

Devvit.addTrigger({
    event: "PostCreate",
    onEvent: async (event: PostChangeEvent, context: AppContext): Promise<void> => {
        await rememberPost(event, context);
    },
});

Devvit.addTrigger({
    event: "PostUpdate",
    onEvent: async (event: PostChangeEvent, context: AppContext): Promise<void> => {
        await rememberPost(event, context);
    },
});

// The modqueue monitor. A failing run rejects, so the scheduler records it.
Devvit.addSchedulerJob({
    name: MONITOR_JOB_NAME,
    onRun: async (_event: unknown, context: AppContext): Promise<void> => {
        await runModqueueMonitor(context);
    },
});

// Forms and menu items, for moderators only.

const testForm = Devvit.createForm(
    {
        title: "Reddit Mod Action Bot",
        description: "Test your bot configuration and send a test alert to Slack",
        fields: [
            {
                name: "info",
                label: "Bot Status",
                type: "paragraph",
                defaultValue:
                    'This bot monitors moderator actions and sends notifications to Slack. Click "Send Test Alert" to verify your webhook configuration.',
                disabled: true,
            },
        ],
        acceptLabel: "Send Test Alert",
        cancelLabel: "Close",
    },
    async (_event: unknown, context: MenuContext): Promise<void> => {
        // Delivery failures are logged, not reported: the toast confirms only that the test was sent.
        await testSlackConnection(context);
        context.ui.showToast({
            text: "🧪 Test alert sent! Check your Slack channel and bot logs.",
            appearance: "success",
        });
    },
);

const simulateActionForm = Devvit.createForm(
    simulateForm,
    async ({ values }: Readonly<{ values: SimulateFormValues }>, context: MenuContext): Promise<void> => {
        try {
            await sendSimulatedModAction(values, context);
            context.ui.showToast({ text: "✅ Simulation delivered to Slack!", appearance: "success" });
        } catch (error) {
            console.error("Failed to send simulated action", error);
            context.ui.showToast({ text: "❌ Could not send simulation. Check logs.", appearance: "neutral" });
        }
    },
);

Devvit.addMenuItem({
    label: "Test Slack Connection",
    location: "subreddit",
    forUserType: "moderator",
    onPress: (_event: unknown, context: MenuContext): void => {
        context.ui.showForm(testForm);
    },
});

Devvit.addMenuItem({
    label: "Show Bot Status",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event: unknown, context: MenuContext): Promise<void> => {
        context.ui.showToast({ text: describeStatus(await botStatus(context)), appearance: "neutral" });
    },
});

Devvit.addMenuItem({
    label: "Simulate Mod Action",
    location: "subreddit",
    forUserType: "moderator",
    onPress: (_event: unknown, context: MenuContext): void => {
        context.ui.showForm(simulateActionForm);
    },
});

Devvit.addMenuItem({
    label: "Setup Modqueue Monitoring",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event: unknown, context: MenuContext): Promise<void> => {
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
            console.error("Failed to setup modqueue monitoring:", error);
            context.ui.showToast({ text: "❌ Failed to setup modqueue monitoring", appearance: "neutral" });
        }
    },
});

export default Devvit;
