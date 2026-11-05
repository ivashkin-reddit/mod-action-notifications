import { vi } from "vitest";
import type { Mock } from "vitest";

/** A field of a Slack attachment. */
export type SlackField = Readonly<{ title: string; value: string; short: boolean }>;

/** A message as the app posts it with chat.postMessage. */
export interface SlackMessage {
    readonly text: string;
    readonly username?: string;
    readonly icon_emoji?: string;
    readonly channel?: string;
    readonly attachments?: readonly Readonly<{
        color: string;
        text?: string;
        fields?: readonly SlackField[];
        footer?: string;
        ts?: number;
        mrkdwn_in?: readonly string[];
    }>[];
}

/** A call the app made to Slack's Web API. */
export interface SlackRequest {
    readonly url: string;
    /** The Web API method the call names, the last part of its URL: chat.postMessage. */
    readonly api: string;
    /** The HTTP method. */
    readonly method: string | undefined;
    readonly headers: unknown;
    /** The message the call carries as its JSON body. */
    readonly message: SlackMessage;
    /** Date.now() when the request was made. */
    readonly sentAt: number;
}

/** A rate-limited answer: 429, with the Retry-After header Slack sends. */
export type RateLimited = Readonly<{ retryAfterSeconds: number }>;

/** An HTTP status with a body of the test's choosing. */
export type Answer = Readonly<{ status: number; body: string }>;

/**
 * What Slack does with one call: refuse it with an error code, answered with HTTP 200 as Slack does
 * (`"not_in_channel"`); answer an HTTP status with a body that is not Slack's, as a proxy's error page would be;
 * answer 429 with a Retry-After; answer as given; or fail with a network error.
 */
export type Outcome = string | number | RateLimited | Answer | Readonly<Error>;

type FetchInit = Readonly<{ method?: string; headers?: unknown; body?: unknown }>;

interface FakeResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly headers: Readonly<{ get: (name: string) => string | null }>;
    readonly text: () => Promise<string>;
}

export interface FakeSlack {
    readonly requests: readonly SlackRequest[];
    readonly messages: readonly SlackMessage[];
    readonly fetch: Mock<(url: string, init?: FetchInit) => Promise<FakeResponse>>;
    /** Queues outcomes for the next requests, in order; requests after these are taken. */
    readonly respond: (...outcomes: readonly Outcome[]) => void;
}

const OK = 200;
const TOO_MANY_REQUESTS = 429;
const FIRST_NON_SUCCESS = 300;
const MS_PER_SECOND = 1000;
const TS_SEQUENCE_DIGITS = 6;

function isSlackMessage(value: unknown): value is SlackMessage {
    return typeof value === "object" && value !== null && "text" in value && typeof value.text === "string";
}

function slackMessageIn(body: unknown): SlackMessage {
    const parsed: unknown = typeof body === "string" ? JSON.parse(body) : undefined;
    if (!isSlackMessage(parsed)) {
        throw new TypeError(`not a Slack message: ${String(body)}`);
    }
    return parsed;
}

function response(status: number, body: string, retryAfter: string | null = null): FakeResponse {
    return {
        ok: status >= OK && status < FIRST_NON_SUCCESS,
        status,
        statusText: `status ${String(status)}`,
        headers: { get: (name: string): string | null => (name.toLowerCase() === "retry-after" ? retryAfter : null) },
        text: async (): Promise<string> => await Promise.resolve(body),
    };
}

/** Slack's answer to a call it took: where the message went, and its timestamp, unique to it. */
function taken(request: SlackRequest, sequence: number): FakeResponse {
    const seconds = Math.floor(request.sentAt / MS_PER_SECOND);
    const ts = `${String(seconds)}.${String(sequence).padStart(TS_SEQUENCE_DIGITS, "0")}`;
    return response(OK, JSON.stringify({ ok: true, channel: request.message.channel ?? "", ts }));
}

function responseFor(
    outcome: string | number | RateLimited | Answer,
    request: SlackRequest,
    sequence: number,
): FakeResponse {
    if (typeof outcome === "string") {
        return response(OK, JSON.stringify({ ok: false, error: outcome }));
    }
    if (typeof outcome === "number") {
        return outcome === OK ? taken(request, sequence) : response(outcome, "error");
    }
    return "status" in outcome
        ? response(outcome.status, outcome.body)
        : response(
              TOO_MANY_REQUESTS,
              JSON.stringify({ ok: false, error: "ratelimited" }),
              String(outcome.retryAfterSeconds),
          );
}

/**
 * Replaces global `fetch` with Slack's Web API, which takes each call unless told otherwise. Responses are plain
 * objects rather than `Response`s, so reading a body needs no real I/O under fake timers.
 */
export function createFakeSlack(): FakeSlack {
    const requests: SlackRequest[] = [];
    const outcomes: (string | number | RateLimited | Answer | Error)[] = [];
    return {
        requests,
        get messages(): readonly SlackMessage[] {
            return requests.map((request: SlackRequest): SlackMessage => request.message);
        },
        fetch: vi.fn(async (url: string, init?: FetchInit): Promise<FakeResponse> => {
            const request: SlackRequest = {
                url,
                api: url.slice(url.lastIndexOf("/") + 1),
                method: init?.method,
                headers: init?.headers,
                message: slackMessageIn(init?.body),
                sentAt: Date.now(),
            };
            requests.push(request);
            const outcome = outcomes.shift() ?? OK;
            if (outcome instanceof Error) {
                throw outcome;
            }
            return await Promise.resolve(responseFor(outcome, request, requests.length));
        }),
        respond: (...queued: readonly Outcome[]): void => {
            outcomes.push(...queued);
        },
    };
}
