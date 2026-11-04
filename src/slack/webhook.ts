import type { SlackMessage, SlackSender } from "./message.js";

const MAX_RETRIES = 3;
const FIRST_RETRY_DELAY_MS = 1000;
const BACKOFF_FACTOR = 2;
const FIRST_SERVER_ERROR = 500;
const TOO_MANY_REQUESTS = 429;
/** Devvit's HTTP plugin reports a request that ran out of time with this in its message. */
const DEADLINE_EXCEEDED = "deadline exceeded";

/** Waits 1, 2, then 4 seconds before the first, second and third retry. */
async function backOff(retryCount: number): Promise<void> {
    await new Promise<void>((resolve): void => {
        setTimeout(resolve, FIRST_RETRY_DELAY_MS * BACKOFF_FACTOR ** retryCount);
    });
}

/** The parts of Slack's response the app reads. */
type SlackResponse = Readonly<Pick<Response, "ok" | "status" | "statusText" | "text">>;

/** Whether to retry after Slack answered: on a server error or rate limiting, while retries remain. */
async function retriesAfterResponse(response: SlackResponse, retryCount: number): Promise<boolean> {
    if (response.ok) {
        // Read the body only to finish the request; its content does not matter.
        await response.text().catch((): null => null);
        return false;
    }
    const responseText = await response.text();
    const retryable = response.status >= FIRST_SERVER_ERROR || response.status === TOO_MANY_REQUESTS;
    if (retryable && retryCount < MAX_RETRIES) {
        return true;
    }
    console.error("Slack webhook request failed - verify webhook URL is correct:", {
        status: response.status,
        statusText: response.statusText,
        responseText,
        troubleshooting: "Check: 1) Webhook URL is valid, 2) Slack workspace permissions, 3) Network connectivity",
    });
    return false;
}

/** Whether to retry after the request failed: unless it ran out of time, while retries remain. */
function retriesAfterFailure(error: unknown, message: SlackMessage, retryCount: number): boolean {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const ranOutOfTime = errorMessage.includes(DEADLINE_EXCEEDED);
    if (retryCount < MAX_RETRIES && !ranOutOfTime) {
        return true;
    }
    if (ranOutOfTime || errorMessage.includes("timeout")) {
        console.error(
            "Slack webhook request timed out - Slack may be experiencing delays or webhook URL may be incorrect",
            {
                channel: message.channel ?? "default",
                error: errorMessage,
                troubleshooting: "Verify webhook URL in settings and check Slack status at status.slack.com",
            },
        );
    } else {
        console.error("Error sending Slack message - check webhook URL and network connectivity:", error);
    }
    return false;
}

/** Sends the message once; whether to retry. */
async function sendOnce(webhookUrl: string, message: SlackMessage, retryCount: number): Promise<boolean> {
    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message),
        });
        return await retriesAfterResponse(response, retryCount);
    } catch (error) {
        return retriesAfterFailure(error, message, retryCount);
    }
}

/**
 * Posts the message, retrying server errors, rate limiting and network errors up to three times with exponential
 * backoff. Never rejects: a delivery failure must not break the trigger that sent it.
 */
async function postToSlack(webhookUrl: string, message: SlackMessage, retryCount: number): Promise<void> {
    if (await sendOnce(webhookUrl, message, retryCount)) {
        await backOff(retryCount);
        await postToSlack(webhookUrl, message, retryCount + 1);
    }
}

/** A sender that posts to the webhook URL, an https URL. */
export function createWebhookSender(webhookUrl: string): SlackSender {
    return async (message: SlackMessage): Promise<void> => {
        await postToSlack(webhookUrl, message, 0);
    };
}

/** Sends a test message to the webhook's own channel, or logs that no webhook is configured (''). */
export async function sendTestMessage(webhookUrl: string): Promise<void> {
    if (webhookUrl === "") {
        console.error("Cannot test: Slack webhook URL not configured");
        return;
    }

    await postToSlack(
        webhookUrl,
        {
            text: "🧪 Test message from Reddit Mod Action Bot",
            username: "Reddit Mod Bot (Test)",
            icon_emoji: ":robot_face:",
            attachments: [
                {
                    color: "#00ff00",
                    fields: [
                        { title: "Status", value: "Bot is working correctly!", short: true },
                        { title: "Timestamp", value: new Date().toISOString(), short: true },
                    ],
                    footer: "Reddit Mod Action Bot - Test Message",
                },
            ],
        },
        0,
    );
}
