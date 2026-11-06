import type { Form } from "@devvit/public-api";
import { configOf, healthReports, settingsOf, slackApiOf, slackSetup } from "./composition.js";
import type { AppContext, SlackSetup } from "./composition.js";
import type { MenuContext } from "./menuActions.js";
import type { AppConfig } from "./settings/index.js";
import { connectSlack, disconnectSlack, sendTestMessage } from "./slack/delivery.js";
import type { Connecting } from "./slack/delivery.js";

/**
 * The composition root's Slack connection: what Connect Slack and Test Slack Connection do for the moderator who
 * invoked them, and the toasts that tell them how it went. main.ts registers the menu items and forms.
 */

type Toast = Readonly<{ text: string; appearance: "neutral" | "success" }>;

/** Connect Slack's form: the bot token of the Slack app the moderators made from the manifest. */
export const connectForm: Form = {
    title: "Connect Slack",
    description:
        "Make a Slack app in your workspace from this app's manifest, install it, and add it to your alert channels. Then paste its Bot User OAuth Token here. The app keeps it, and never shows it again.",
    fields: [
        {
            name: "token",
            label: "Slack Bot Token",
            type: "string",
            helpText: "Starts xoxb-, from your Slack app's OAuth & Permissions page. Leave it empty to disconnect.",
        },
    ],
    acceptLabel: "Connect",
    cancelLabel: "Cancel",
};

/** What the Connect Slack form gives: the token typed in, if any. */
export type ConnectFormValues = Readonly<{ token?: string | undefined }>;

const DISCONNECTED_TOAST: Toast = {
    text: "Slack is disconnected: no alerts are sent until it is connected again.",
    appearance: "neutral",
};

const CHANNEL_FIRST_TOAST: Toast = {
    text: "⚠️ Set the Notification Channel in the app's settings, add the Slack app to it, then connect.",
    appearance: "neutral",
};

function connectingToast(connecting: Connecting): Toast {
    switch (connecting.outcome) {
        case "connected": {
            return {
                text: `✅ Connected to ${connecting.team}. A message from the app is in each alert channel.`,
                appearance: "success",
            };
        }
        case "not-a-bot-token": {
            return {
                text: "❌ That isn't a bot token. Copy the Bot User OAuth Token, which starts xoxb-, from your Slack app's OAuth & Permissions page.",
                appearance: "neutral",
            };
        }
        case "token-refused": {
            return {
                text: `❌ Slack didn't take that token (${connecting.detail}). Copy the Bot User OAuth Token from your Slack app's OAuth & Permissions page.`,
                appearance: "neutral",
            };
        }
        case "channel-refused": {
            return {
                text: `❌ Slack didn't post to ${connecting.channel} (${connecting.detail}). Add the Slack app to the channel, then connect again.`,
                appearance: "neutral",
            };
        }
    }
}

/** Logs what Slack refused, for the developer: the moderator was told. Never the token. */
function logRefusal(connecting: Connecting): void {
    if (connecting.outcome === "token-refused") {
        console.warn(`[menu] Slack didn't take the token to connect: ${connecting.detail}`);
    } else if (connecting.outcome === "channel-refused") {
        console.warn(`[menu] Slack didn't post to an alert channel when connecting: ${connecting.detail}`);
    }
}

async function subredditNameOf(context: MenuContext): Promise<string> {
    return context.subredditName === undefined || context.subredditName === ""
        ? await context.reddit.getCurrentSubredditName()
        : context.subredditName;
}

/** The channels alerts go to, each once: the Notification Channel, and the Alert Channel when it is set. */
function alertChannels({ notificationChannel, alertChannel }: Readonly<AppConfig>): readonly string[] {
    return [...new Set([notificationChannel, alertChannel])].filter((channel: string): boolean => channel !== "");
}

/** Connects with the token, once the Notification Channel is set; what to tell the moderator. */
async function connectWith(token: string, context: MenuContext): Promise<Toast> {
    const config = await settingsOf(context);
    if (config.notificationChannel === "") {
        return CHANNEL_FIRST_TOAST;
    }
    const connecting = await connectSlack(
        { redis: context.redis, scheduler: context.scheduler, health: healthReports(context) },
        {
            api: { token, fetch: context.fetch },
            channels: alertChannels(config),
            subredditName: await subredditNameOf(context),
        },
    );
    logRefusal(connecting);
    return connectingToast(connecting);
}

/**
 * Connects the installation to the workspace whose bot token the moderator gave, once Slack takes it and posts to the
 * alert channels; disconnects it when they gave none. Tells them how it went.
 */
export async function connectFromForm(values: ConnectFormValues, context: MenuContext): Promise<void> {
    const token = (values.token ?? "").trim();
    if (token === "") {
        await disconnectSlack(context.redis);
        context.ui.showToast(DISCONNECTED_TOAST);
        return;
    }
    context.ui.showToast(await connectWith(token, context));
}

/** Test Slack Connection's form, which sends a test message when the moderator asks. */
export const testForm: Form = {
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
};

/** How sending a test message went, or what kept it from being sent. */
type ConnectionTest = "delivered" | Exclude<SlackSetup, "set-up"> | "failed";

const CONNECTION_TEST_TOASTS: Readonly<Record<ConnectionTest, Toast>> = {
    "delivered": { text: "🧪 Test alert sent! Check your Slack channel and bot logs.", appearance: "success" },
    "token-missing": { text: "⚠️ Slack isn't connected. Use Connect Slack first.", appearance: "neutral" },
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
    return (await sendTestMessage(slackApiOf(context, config), config.notificationChannel)) ? "delivered" : "failed";
}

/** Sends a test message to Slack, and says how it went. */
export async function sendTestAlert(context: MenuContext): Promise<void> {
    context.ui.showToast(CONNECTION_TEST_TOASTS[await testSlackConnection(context)]);
}
