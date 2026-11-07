import { inChannel } from "./message.js";
import type { DirectSlackSender, SlackMessage } from "./message.js";

/** A request to Slack's Web API, as callSlack makes it. */
type SlackRequest = Readonly<{ method: "POST"; headers: Readonly<Record<string, string>>; body: string }>;

/** The parts of an HTTP response the app reads. */
export type SlackHttpResponse = Readonly<
    Pick<Response, "ok" | "status" | "text"> & { headers: Readonly<{ get: (name: string) => string | null }> }
>;

/** The fetch Slack is called with: the global one, or one that counts calls for an invocation's completion line. */
export type SlackFetch = (url: string, init: SlackRequest) => Promise<SlackHttpResponse>;

/** What a call to Slack's Web API is made with: the Slack app's bot token, and the fetch that carries it. */
export type SlackApi = Readonly<{ token: string; fetch: SlackFetch }>;

/** Slack's Web API, on the one host the app may fetch (devvit.json permissions.http.domains). */
const API_URL = "https://slack.com/api/";
const MS_PER_SECOND = 1000;
/** A direct send retries this many times. */
const MAX_RETRIES = 3;
const FIRST_RETRY_DELAY_MS = 1000;
const BACKOFF_FACTOR = 2;
const FIRST_SERVER_ERROR = 500;
const TOO_MANY_REQUESTS = 429;
const FIRST_SUCCESS = 200;
const FIRST_NON_SUCCESS = 300;
const DECIMAL = 10;
/** Devvit's HTTP plugin reports a request that ran out of time with this in its message. */
const DEADLINE_EXCEEDED = "deadline exceeded";

/**
 * The error codes with which Slack says it may take a call later: rate limiting, and failures of its own
 * (docs.slack.dev, chat.postMessage, "Errors"). Any other error code means it would refuse the call again.
 */
const RETRYABLE_ERRORS: readonly string[] = [
    "ratelimited",
    "rate_limited",
    "fatal_error",
    "internal_error",
    "service_unavailable",
    "request_timeout",
];

export async function wait(ms: number): Promise<void> {
    await new Promise<void>((resolve): void => {
        setTimeout(resolve, ms);
    });
}

/** How long to wait before retry `retryCount` (0 for the first): 1, 2, then 4 seconds. */
export function backoffMs(retryCount: number): number {
    return FIRST_RETRY_DELAY_MS * BACKOFF_FACTOR ** retryCount;
}

/**
 * Why an attempt failed: Slack's answer, with its HTTP status and the error code it gave ('' when it gave none), or
 * no answer at all.
 */
export type Failure =
    | Readonly<{ kind: "response"; status: number; error: string }>
    | Readonly<{ kind: "error"; error: unknown; ranOutOfTime: boolean }>;

/** Slack's answer to a call it took: the fields of its JSON object. */
export type Answer = ReadonlyMap<string, unknown>;

/** How one call to Slack went; `T` is what the app reads from Slack's answer when Slack took it. */
export type Delivery<T = Answer> =
    | Readonly<{ outcome: "delivered"; answer: T }>
    /** Slack may take it later: it is failing or rate limiting (with its Retry-After, if given), or did not answer. */
    | Readonly<{ outcome: "retry"; failure: Failure; retryAfterMs: number | undefined }>
    /** Slack refused it, and would again: a revoked token, or a channel the app is not in. */
    | Readonly<{ outcome: "rejected"; failure: Failure }>;

/** Retry-After in ms, when the header gives a number of seconds. */
function retryAfterMs(header: string | null): number | undefined {
    const seconds = header === null ? Number.NaN : Number.parseInt(header, DECIMAL);
    return Number.isNaN(seconds) || seconds < 0 ? undefined : seconds * MS_PER_SECOND;
}

/** The parts of Slack's response the app reads. */
type SlackResponse = Readonly<Pick<SlackHttpResponse, "ok" | "status" | "text">>;

/** Slack's answer: the fields of the JSON object it always answers with, or none for any other body. */
async function answerOf(response: SlackResponse): Promise<Answer | undefined> {
    try {
        const parsed: unknown = JSON.parse(await response.text());
        return typeof parsed === "object" && parsed !== null ? new Map(Object.entries(parsed)) : undefined;
    } catch {
        // Not JSON, or unreadable: an answer from something on the way to Slack, such as a proxy's error page.
        return undefined;
    }
}

/**
 * Whether Slack may take the call later: it answered a server error, rate limiting or an error code that says so,
 * or a success that was not its own answer, so it is not known to have taken the call.
 */
function mayTakeLater(status: number, error: string, answered: boolean): boolean {
    return (
        status >= FIRST_SERVER_ERROR ||
        status === TOO_MANY_REQUESTS ||
        RETRYABLE_ERRORS.includes(error) ||
        (status >= FIRST_SUCCESS && status < FIRST_NON_SUCCESS && !answered)
    );
}

/** What Slack's response says of the call: Slack took it only when its answer says `ok`. */
async function deliveryOf(response: SlackResponse, retryAfter: number | undefined): Promise<Delivery> {
    const answer = await answerOf(response);
    if (response.ok && answer?.get("ok") === true) {
        return { outcome: "delivered", answer };
    }
    const error = answer?.get("error");
    const failure: Failure = {
        kind: "response",
        status: response.status,
        error: typeof error === "string" ? error : "",
    };
    return mayTakeLater(response.status, failure.error, answer !== undefined)
        ? { outcome: "retry", failure, retryAfterMs: retryAfter }
        : { outcome: "rejected", failure };
}

/** The Web API methods the app calls: the chat methods need only the chat:write scope, auth.test none. */
type SlackMethod = "auth.test" | "chat.postMessage" | "chat.update" | "chat.delete";

/**
 * Calls a Web API method once, with the Slack app's bot token. The token goes in the authorization header, never in
 * a URL, so no error names it. Never rejects.
 */
async function callSlack({ token, fetch }: SlackApi, method: SlackMethod, body: unknown): Promise<Delivery> {
    try {
        const response = await fetch(`${API_URL}${method}`, {
            method: "POST",
            // Header names are not case-sensitive.
            headers: { "content-type": "application/json; charset=utf-8", "authorization": `Bearer ${token}` },
            body: JSON.stringify(body),
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

/** Where Slack put a message: its channel's ID and its timestamp, which together name it. */
export type Posted = Readonly<{ channel: string; ts: string }>;

function textIn(answer: Readonly<Pick<Answer, "get">>, field: string): string {
    const value = answer.get(field);
    return typeof value === "string" ? value : "";
}

/** Posts the message to its channel once; where Slack put it, when it took it ('' for what its answer left out). */
export async function postMessage(api: SlackApi, message: SlackMessage): Promise<Delivery<Posted>> {
    const delivery = await callSlack(api, "chat.postMessage", message);
    return delivery.outcome === "delivered"
        ? {
              outcome: "delivered",
              answer: { channel: textIn(delivery.answer, "channel"), ts: textIn(delivery.answer, "ts") },
          }
        : delivery;
}

/**
 * Puts `message` in place of the app's message at `posted`, once: its text and attachments, which replace all the
 * old ones, as an empty list removes them (docs.slack.dev, chat.update).
 */
export async function updateMessage(api: SlackApi, posted: Posted, message: SlackMessage): Promise<Delivery> {
    return await callSlack(api, "chat.update", {
        channel: posted.channel,
        ts: posted.ts,
        text: message.text,
        attachments: message.attachments ?? [],
    });
}

/** Asks Slack, once, whose the token is; the name of its workspace, when Slack takes it. */
async function authTest(api: SlackApi): Promise<Delivery<Readonly<{ team: string }>>> {
    const delivery = await callSlack(api, "auth.test", {});
    return delivery.outcome === "delivered"
        ? { outcome: "delivered", answer: { team: textIn(delivery.answer, "team") } }
        : delivery;
}

/** Deletes the app's message at `posted`, once. */
export async function deleteMessage(api: SlackApi, posted: Posted): Promise<Delivery> {
    return await callSlack(api, "chat.delete", { channel: posted.channel, ts: posted.ts });
}

/** At most this much of an error code goes into a log line: one from something other than Slack could be anything. */
const ERROR_LOGGED = 100;

/** What Slack answered, or why there was no answer, in a few words: `not_in_channel`, `HTTP 503` or the error. */
export function failureDetail(failure: Failure): string {
    if (failure.kind === "response") {
        return failure.error === "" ? `HTTP ${String(failure.status)}` : failure.error.slice(0, ERROR_LOGGED);
    }
    return failure.error instanceof Error ? failure.error.message : String(failure.error);
}

/** Logs why a message sent straight to Slack, for a moderator waiting on it, did not reach Slack. */
function logFailure(failure: Failure): void {
    console.warn(
        `[slack] Slack did not take a message sent straight to it (${failureDetail(failure)}). Check the channel in the app's settings, and that the Slack app has been added to it.`,
    );
}

/** Whether a direct send retries after this attempt: Slack may take it later, and the request did not time out. */
function retriesDirectly(delivery: Delivery<unknown>, retryCount: number): boolean {
    return (
        delivery.outcome === "retry" &&
        !(delivery.failure.kind === "error" && delivery.failure.ranOutOfTime) &&
        retryCount < MAX_RETRIES
    );
}

/**
 * Makes a call for a moderator waiting on it, retrying server errors, rate limiting and network errors up to three
 * times with exponential backoff; how the last attempt went. Never rejects.
 */
async function withDirectRetries<T>(call: () => Promise<Delivery<T>>, retryCount = 0): Promise<Delivery<T>> {
    const delivery = await call();
    if (!retriesDirectly(delivery, retryCount)) {
        return delivery;
    }
    await wait(backoffMs(retryCount));
    return await withDirectRetries(call, retryCount + 1);
}

/** Posts the message for a moderator waiting on it, retrying as withDirectRetries does. Never rejects. */
export async function postDirectly(api: SlackApi, message: SlackMessage): Promise<Delivery<Posted>> {
    return await withDirectRetries(async (): Promise<Delivery<Posted>> => await postMessage(api, message));
}

/** Asks Slack whose the token is, for a moderator waiting on it, retrying as withDirectRetries does. */
export async function checkToken(api: SlackApi): Promise<Delivery<Readonly<{ team: string }>>> {
    return await withDirectRetries(async (): Promise<Delivery<Readonly<{ team: string }>>> => await authTest(api));
}

/** Posts the message as postDirectly does; true when Slack accepted it, the failure logged when not. */
async function postToSlack(api: SlackApi, message: SlackMessage): Promise<boolean> {
    const delivery = await postDirectly(api, message);
    if (delivery.outcome !== "delivered") {
        logFailure(delivery.failure);
        return false;
    }
    return true;
}

/**
 * A sender that posts straight to Slack with the bot token, retrying as postToSlack does: for a moderator waiting on
 * the result. Alerts go through the outbox instead.
 */
export function createDirectSender(api: SlackApi): DirectSlackSender {
    return async (message: SlackMessage): Promise<boolean> => await postToSlack(api, message);
}

/** Sends a test message to the channel, a channel ID or name; true when Slack accepted it. */
export async function sendTestMessage(api: SlackApi, channel: string): Promise<boolean> {
    return await postToSlack(
        api,
        inChannel(
            {
                text: "🧪 Test message from Mod Action Notifications",
                attachments: [
                    {
                        color: "#00ff00",
                        fields: [
                            { title: "Status", value: "The app is working correctly!", short: true },
                            { title: "Timestamp", value: new Date().toISOString(), short: true },
                        ],
                        footer: "Mod Action Notifications - Test Message",
                    },
                ],
            },
            channel,
        ),
    );
}
