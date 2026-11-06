/**
 * The app's entry point and composition root: everything it registers with Devvit (settings, triggers, the
 * scheduler jobs, forms and menu items). triggers.ts, scheduledJobs.ts and menuActions.ts do what each does,
 * composition.ts builds what they share, and the capability modules do the work.
 */
import { Devvit } from "@devvit/public-api";
import type { CommentUpdateEvent, PostUpdateEvent } from "./approvedEdits/index.js";
import {
    onAutomoderatorFilter,
    onCommentReport,
    onCommentUpdate,
    onModMail,
    onPostReport,
    onPostUpdate,
} from "./communityTriggers.js";
import type { FilterEvent } from "./communityTriggers.js";
import type { AppContext } from "./composition.js";
import { SUMMARY_JOB_NAME } from "./health/index.js";
import {
    botStatus,
    forModerators,
    readOnlyForm,
    sendSimulation,
    setUpFromMenu,
    statusForm,
    teamStats,
} from "./menuActions.js";
import type { MenuContext } from "./menuActions.js";
import { ENABLED_ACTIONS_CHOICES, simulateForm } from "./moderation/index.js";
import type { ModActionEvent, SimulateFormValues } from "./moderation/index.js";
import type { ModmailEvent } from "./modmail/index.js";
import { MONITOR_JOB_NAME } from "./modqueue/index.js";
import type { PostDeleteEvent } from "./postDeletion/index.js";
import type { CommentReportEvent, PostReportEvent } from "./reports/index.js";
import {
    deliverQueuedAlerts,
    runModqueueMonitor,
    sendSummary,
    sendWeeklyStatistics,
    setUpScheduledJobs,
} from "./scheduledJobs.js";
import { settingsDefinitions } from "./settings/index.js";
import { OUTBOX_JOB_NAME } from "./slack/delivery.js";
import { connectForm, connectFromForm, sendTestAlert, testForm } from "./slackConnection.js";
import type { ConnectFormValues } from "./slackConnection.js";
import { DIGEST_JOB_NAME } from "./statistics/index.js";
import { alertOnModAction, onCommentDelete, onPostDelete } from "./triggers.js";
import type { CommentDeleteEvent } from "./triggers.js";

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

// A report: urgent reasons alert at once, and reports piling up on a post or comment alert once.
Devvit.addTrigger({
    event: "PostReport",
    onEvent: async (event: PostReportEvent, context: AppContext): Promise<void> => {
        await onPostReport(event, context);
    },
});

Devvit.addTrigger({
    event: "CommentReport",
    onEvent: async (event: CommentReportEvent, context: AppContext): Promise<void> => {
        await onCommentReport(event, context);
    },
});

// AutoModerator held a post or comment for review: the team's response time runs from here.
Devvit.addTrigger({
    event: "AutomoderatorFilterPost",
    onEvent: async (event: FilterEvent, context: AppContext): Promise<void> => {
        await onAutomoderatorFilter(event, context);
    },
});

Devvit.addTrigger({
    event: "AutomoderatorFilterComment",
    onEvent: async (event: FilterEvent, context: AppContext): Promise<void> => {
        await onAutomoderatorFilter(event, context);
    },
});

// An edit: one by the author after a moderator approved the post or comment alerts.
Devvit.addTrigger({
    event: "PostUpdate",
    onEvent: async (event: PostUpdateEvent, context: AppContext): Promise<void> => {
        await onPostUpdate(event, context);
    },
});

Devvit.addTrigger({
    event: "CommentUpdate",
    onEvent: async (event: CommentUpdateEvent, context: AppContext): Promise<void> => {
        await onCommentUpdate(event, context);
    },
});

// A modmail message: one from a Reddit admin alerts at once.
Devvit.addTrigger({
    event: "ModMail",
    onEvent: async (event: ModmailEvent, context: AppContext): Promise<void> => {
        await onModMail(event, context);
    },
});

// The modqueue monitor, which also checks modmail waiting for a reply. A run that fails reports the monitor as
// failing, in the health log, and resolves.
Devvit.addSchedulerJob({
    name: MONITOR_JOB_NAME,
    onRun: async (_event: unknown, context: AppContext): Promise<void> => {
        await runModqueueMonitor(context);
    },
});

// Delivers alerts a drain of the Slack outbox left queued. A run that fails logs it, and resolves.
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

// Sends the team's statistics for the week before each Monday at 08:00 UTC, when the setting is on.
Devvit.addSchedulerJob({
    name: DIGEST_JOB_NAME,
    onRun: async (_event: unknown, context: AppContext): Promise<void> => {
        await sendWeeklyStatistics(context);
    },
});

// Forms and menu items, for moderators only: each checks the user who invokes it.

const slackTestForm = Devvit.createForm(testForm, async (_event: unknown, context: MenuContext): Promise<void> => {
    await forModerators(context, async (): Promise<void> => {
        await sendTestAlert(context);
    });
});

const connectSlackForm = Devvit.createForm(
    connectForm,
    async ({ values }: Readonly<{ values: ConnectFormValues }>, context: MenuContext): Promise<void> => {
        await forModerators(context, async (): Promise<void> => {
            await connectFromForm(values, context);
        });
    },
);

// What Show Bot Status shows: read-only lines, closed with its one button.
const botStatusForm = Devvit.createForm(statusForm, (): void => undefined);

// What Show Team Stats shows: the team's figures for the last 7 days, as read-only lines.
const teamStatsForm = Devvit.createForm(readOnlyForm("Team Statistics, last 7 days"), (): void => undefined);

const simulateActionForm = Devvit.createForm(
    simulateForm,
    async ({ values }: Readonly<{ values: SimulateFormValues }>, context: MenuContext): Promise<void> => {
        await forModerators(context, async (): Promise<void> => {
            await sendSimulation(values, context);
        });
    },
);

Devvit.addMenuItem({
    label: "Connect Slack",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event: unknown, context: MenuContext): Promise<void> => {
        await forModerators(context, (): void => {
            context.ui.showForm(connectSlackForm);
        });
    },
});

Devvit.addMenuItem({
    label: "Test Slack Connection",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event: unknown, context: MenuContext): Promise<void> => {
        await forModerators(context, (): void => {
            context.ui.showForm(slackTestForm);
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
    label: "Show Team Stats",
    location: "subreddit",
    forUserType: "moderator",
    onPress: async (_event: unknown, context: MenuContext): Promise<void> => {
        await forModerators(context, async (): Promise<void> => {
            const stats = await teamStats(context);
            if (stats !== undefined) {
                context.ui.showForm(teamStatsForm, stats);
            }
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
