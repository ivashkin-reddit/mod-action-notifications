import type { DirectSlackSender, SlackMessage } from "./message.js";

const MS_PER_SECOND = 1000;
/** A direct send retries this many times. */
const MAX_RETRIES = 3;
const FIRST_RETRY_DELAY_MS = 1000;
const BACKOFF_FACTOR = 2;
const FIRST_SERVER_ERROR = 500;
const TOO_MANY_REQUESTS = 429;
const DECIMAL = 10;
/** Devvit's HTTP plugin reports a request that ran out of time with this in its message. */
const DEADLINE_EXCEEDED = "deadline exceeded";

export async function wait(ms: number): Promise<void> {
    await new Promise<void>((resolve): void => {
        setTimeout(resolve, ms);
    });
}

/** How long to wait before retry `retryCount` (0 for the first): 1, 2, then 4 seconds. */
export function backoffMs(retryCount: number): number {
    return FIRST_RETRY_DELAY_MS * BACKOFF_FACTOR ** retryCount;
}

/** Why an attempt failed. */
export type Failure =
    | Readonly<{ kind: "response"; status: number; statusText: string; responseText: string }>
    | Readonly<{ kind: "error"; error: unknown; ranOutOfTime: boolean }>;

/** How one attempt to post a message went. */
export type Delivery =
    | Readonly<{ outcome: "delivered" }>
    /** Slack may take it later: a server error, rate limiting (with Slack's Retry-After, if given) or no response. */
    | Readonly<{ outcome: "retry"; failure: Failure; retryAfterMs: number | undefined }>
    /** Slack refused it, and would again: a client error such as a revoked webhook. */
    | Readonly<{ outcome: "rejected"; failure: Failure }>;

/** The parts of Slack's response the app reads. */
type SlackResponse = Readonly<Pick<Response, "ok" | "status" | "statusText" | "text">>;

/** Retry-After in ms, when the header gives a number of seconds. */
function retryAfterMs(header: string | null): number | undefined {
    const seconds = header === null ? Number.NaN : Number.parseInt(header, DECIMAL);
    return Number.isNaN(seconds) || seconds < 0 ? undefined : seconds * MS_PER_SECOND;
}

async function deliveryOf(response: SlackResponse, retryAfter: number | undefined): Promise<Delivery> {
    if (response.ok) {
        // Read the body only to finish the request; its content does not matter.
        await response.text().catch((): null => null);
        return { outcome: "delivered" };
    }
    const failure: Failure = {
        kind: "response",
        status: response.status,
        statusText: response.statusText,
        responseText: await response.text(),
    };
    return response.status >= FIRST_SERVER_ERROR || response.status === TOO_MANY_REQUESTS
        ? { outcome: "retry", failure, retryAfterMs: retryAfter }
        : { outcome: "rejected", failure };
}

/** Posts the message to the webhook once. Never rejects. */
export async function attemptDelivery(webhookUrl: string, message: SlackMessage): Promise<Delivery> {
    try {
        const response = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(message),
        });
        return await deliveryOf(response, retryAfterMs(response.headers.get("retry-after")));
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            outcome: "retry",
            failure: { kind: "error", error, ranOutOfTime: errorMessage.includes(DEADLINE_EXCEEDED) },
            retryAfterMs: undefined,
        };
    }
}

/** A Slack webhook URL's secret: its path, with which anyone can post to the channel. */
const WEBHOOK_SECRET = /(?<=hooks\.slack\.com\/services\/)[^\s"'<>]+/giu;

/** `text` with the secret path of any Slack webhook URL in it left out, so an error that names the URL can be logged. */
function withoutWebhookSecret(text: string): string {
    return text.replace(WEBHOOK_SECRET, "…");
}

/** At most this much of Slack's answer goes into a log line. */
const RESPONSE_TEXT_LOGGED = 100;

/** What Slack answered, or why there was no answer, in a few words: `HTTP 404: no_service` or the error. */
export function failureDetail(failure: Failure): string {
    if (failure.kind === "response") {
        return `HTTP ${String(failure.status)}: ${failure.responseText.slice(0, RESPONSE_TEXT_LOGGED)}`;
    }
    return withoutWebhookSecret(failure.error instanceof Error ? failure.error.message : String(failure.error));
}

/** Logs why a message sent straight to Slack, for a moderator waiting on it, did not reach Slack. */
function logFailure(failure: Failure): void {
    console.warn(
        `[slack] Slack did not take a message sent straight to it (${failureDetail(failure)}). Check the webhook URL in the app's settings.`,
    );
}

/** Whether a direct send retries after this attempt: Slack may take it later, and the request did not time out. */
function retriesDirectly(delivery: Delivery, retryCount: number): boolean {
    return (
        delivery.outcome === "retry" &&
        !(delivery.failure.kind === "error" && delivery.failure.ranOutOfTime) &&
        retryCount < MAX_RETRIES
    );
}

/**
 * Posts the message, retrying server errors, rate limiting and network errors up to three times with exponential
 * backoff; true when Slack accepted it. Never rejects.
 */
async function postToSlack(webhookUrl: string, message: SlackMessage, retryCount: number): Promise<boolean> {
    const delivery = await attemptDelivery(webhookUrl, message);
    if (delivery.outcome === "delivered") {
        return true;
    }
    if (!retriesDirectly(delivery, retryCount)) {
        logFailure(delivery.failure);
        return false;
    }
    await wait(backoffMs(retryCount));
    return await postToSlack(webhookUrl, message, retryCount + 1);
}

/**
 * A sender that posts straight to the webhook, an https URL, retrying as postToSlack does: for a moderator waiting
 * on the result. Alerts go through the outbox instead.
 */
export function createWebhookSender(webhookUrl: string): DirectSlackSender {
    return async (message: SlackMessage): Promise<boolean> => await postToSlack(webhookUrl, message, 0);
}

/** Sends a test message to the webhook's own channel, at an https URL; true when Slack accepted it. */
export async function sendTestMessage(webhookUrl: string): Promise<boolean> {
    return await postToSlack(
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
