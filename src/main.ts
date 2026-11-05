/**
 * The app's entry point and composition root: everything it registers with Devvit (settings, triggers, the
 * scheduler jobs, forms and menu items). composition.ts builds what each trigger and job needs, menuActions.ts does
 * what each menu item and form does, and the capability modules do the work.
 */
import { Devvit } from "@devvit/public-api";
import { alertOnModAction, onCommentDelete, onPostDelete } from "./composition.js";
import type { AppContext, CommentDeleteEvent } from "./composition.js";
import { SUMMARY_JOB_NAME } from "./health/index.js";
import { botStatus, forModerators, sendSimulation, sendTestAlert, setUpFromMenu, statusForm } from "./menuActions.js";
import type { MenuContext } from "./menuActions.js";
import { ENABLED_ACTIONS_CHOICES, simulateForm } from "./moderation/index.js";
import type { ModActionEvent, SimulateFormValues } from "./moderation/index.js";
import { MONITOR_JOB_NAME } from "./modqueue/index.js";
import type { PostDeleteEvent } from "./postDeletion/index.js";
import { deliverQueuedAlerts, runModqueueMonitor, sendSummary, setUpScheduledJobs } from "./scheduledJobs.js";
import { settingsDefinitions } from "./settings/index.js";
import { OUTBOX_JOB_NAME } from "./slack/delivery.js";

// devvit.json grants these permissions; Devvit 0.15 takes them from there, not from here.
Devvit.configure({
    redditAPI: true,
    http: {
        domains: ["slack.com"],
    },
    redis: true,
});

Devvit.addSettings(settingsDefinitions(ENABLED_ACTIONS_CHOICES));

// Triggers. devvit.json must list every trigger registered here.

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: async (_event: unknown, context: AppContext): Promise<void> => {
        console.info(`[setup] Installed version ${context.appVersion}`);
        try {
            await setUpScheduledJobs(context);
        } catch (error) {
            console.error("[setup] Could not set up the modqueue monitor on install:", error);
        }
    },
});

Devvit.addTrigger({
    event: "AppUpgrade",
    onEvent: async (_event: unknown, context: AppContext): Promise<void> => {
        console.info(`[setup] Upgraded to version ${context.appVersion}`);
        try {
            await setUpScheduledJobs(context);
        } catch (error) {
            console.error("[setup] Could not set up the modqueue monitor on upgrade:", error);
        }
    },
});

Devvit.addTrigger({
    event: "ModAction",
    onEvent: async (event: ModActionEvent, context: AppContext): Promise<void> => {
        await alertOnModAction(event, context);
    },
});

// A deleted post or comment leaves the alerts still waiting for Slack.
Devvit.addTrigger({
    event: "PostDelete",
    onEvent: async (event: PostDeleteEvent, context: AppContext): Promise<void> => {
        await onPostDelete(event, context);
    },
});

Devvit.addTrigger({
    event: "CommentDelete",
    onEvent: async (event: CommentDeleteEvent, context: AppContext): Promise<void> => {
        await onCommentDelete(event, context);
    },
});

// The modqueue monitor. A run that fails reports the monitor as failing, in the health log, and resolves.
Devvit.addSchedulerJob({
    name: MONITOR_JOB_NAME,
    onRun: async (_event: unknown, context: AppContext): Promise<void> => {
        await runModqueueMonitor(context);
    },
});

// Delivers alerts a drain of the Slack outbox left queued. A failing run rejects, so the scheduler records it.
Devvit.addSchedulerJob({
    name: OUTBOX_JOB_NAME,
    onRun: async (_event: unknown, context: AppContext): Promise<void> => {
        await deliverQueuedAlerts(context);
    },
});

// Sends the summary of the day before at 08:00 UTC, when the setting is on.
Devvit.addSchedulerJob({
    name: SUMMARY_JOB_NAME,
    onRun: async (_event: unknown, context: AppContext): Promise<void> => {
        await sendSummary(context);
    },
});

// Forms and menu items, for moderators only: each checks the user who invokes it.

const testForm = Devvit.createForm(
    {
        title: "Mod Action Notifications",
        description: "Test your bot configuration and send a test alert to Slack",
        fields: [
            {
                name: "info",
                label: "Bot Status",
                type: "paragraph",
                defaultValue:
                    'This app tells your mod team in Slack about moderator actions. Click "Send Test Alert" to check that it can post to your Notification Channel.',
                disabled: true,
            },
        ],
        acceptLabel: "Send Test Alert",
        cancelLabel: "Close",
    },
    async (_event: unknown, context: MenuContext): Promise<void> => {
        await forModerators(context, async (): Promise<void> => {
            await sendTestAlert(context);
        });
    },
);

// What Show Bot Status shows: read-only lines, closed with its one button.
const botStatusForm = Devvit.createForm(statusForm, (): void => undefined);

const simulateActionForm = Devvit.createForm(
    simulateForm,
    async ({ values }: Readonly<{ values: SimulateFormValues }>, context: MenuContext): Promise<void> => {
        await forModerators(context, async (): Promise<void> => {
            await sendSimulation(values, context);
        });
    },
);

Devvit.addMenuItem({
    label: "Test Slack Connection",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event: unknown, context: MenuContext): Promise<void> => {
        await forModerators(context, (): void => {
            context.ui.showForm(testForm);
        });
    },
});

Devvit.addMenuItem({
    label: "Show Bot Status",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event: unknown, context: MenuContext): Promise<void> => {
        await forModerators(context, async (): Promise<void> => {
            context.ui.showForm(botStatusForm, await botStatus(context));
        });
    },
});

Devvit.addMenuItem({
    label: "Simulate Mod Action",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event: unknown, context: MenuContext): Promise<void> => {
        await forModerators(context, (): void => {
            context.ui.showForm(simulateActionForm);
        });
    },
});

Devvit.addMenuItem({
    label: "Setup Modqueue Monitoring",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event: unknown, context: MenuContext): Promise<void> => {
        await forModerators(context, async (): Promise<void> => {
            await setUpFromMenu(context);
        });
    },
});

export default Devvit;
