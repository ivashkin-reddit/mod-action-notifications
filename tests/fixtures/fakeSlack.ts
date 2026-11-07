import { vi } from "vitest";
import type { Mock } from "vitest";

/** A field of a Slack attachment. */
export type SlackField = Readonly<{ title: string; value: string; short: boolean }>;

/** A message as the app posts it with chat.postMessage. */
export interface SlackMessage {
    readonly text: string;
    readonly username?: string;
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

/** What a chat.update call asks for: the message at `channel` and `ts` to say this instead. */
export type SlackUpdate = SlackMessage & Readonly<{ channel: string; ts: string }>;

/** What a chat.delete call asks for: the message at `channel` and `ts` deleted. */
export type SlackDelete = Readonly<{ channel: string; ts: string }>;

/** A call the app made to Slack's Web API. */
export interface SlackRequest {
    readonly url: string;
    /** The Web API method the call names, the last part of its URL: chat.postMessage. */
    readonly api: string;
    /** The HTTP method. */
    readonly method: string | undefined;
    readonly headers: unknown;
    /** The call's JSON body. */
    readonly body: Readonly<Record<string, unknown>>;
    /** The message a chat.postMessage or chat.update call carries; undefined for chat.delete, which carries none. */
    readonly message: SlackMessage | undefined;
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
    /** The messages posted with chat.postMessage. */
    readonly messages: readonly SlackMessage[];
    /** The edits asked for with chat.update. */
    readonly updates: readonly SlackUpdate[];
    /** The deletions asked for with chat.delete. */
    readonly deletes: readonly SlackDelete[];
    readonly fetch: Mock<(url: string, init?: FetchInit) => Promise<FakeResponse>>;
    /** Queues outcomes for the next requests, in order; requests after these are taken. */
    readonly respond: (...outcomes: readonly Outcome[]) => void;
    /** Queues an outcome for the next request, given after `afterMs`: a slow Slack. */
    readonly respondSlowly: (afterMs: number, outcome: Outcome) => void;
}

const OK = 200;
const TOO_MANY_REQUESTS = 429;
const FIRST_NON_SUCCESS = 300;
const MS_PER_SECOND = 1000;
const TS_SEQUENCE_DIGITS = 6;
/** The name of the Slack workspace whose token the fake takes, as auth.test answers it. */
export const WORKSPACE = "Test Workspace";

function isSlackMessage(value: unknown): value is SlackMessage {
    return typeof value === "object" && value !== null && "text" in value && typeof value.text === "string";
}

function bodyOf(body: unknown): Readonly<Record<string, unknown>> {
    const parsed: unknown = typeof body === "string" ? JSON.parse(body) : undefined;
    if (typeof parsed !== "object" || parsed === null) {
        throw new TypeError(`not a JSON object: ${String(body)}`);
    }
    return Object.fromEntries(Object.entries(parsed));
}

/** The message a call carries, which every call but chat.delete and auth.test must. */
function messageIn(api: string, body: Readonly<Record<string, unknown>>): SlackMessage | undefined {
    if (api === "chat.delete" || api === "auth.test") {
        return undefined;
    }
    if (!isSlackMessage(body)) {
        throw new TypeError(`not a Slack message: ${JSON.stringify(body)}`);
    }
    return body;
}

function textOf(value: unknown): string {
    return typeof value === "string" ? value : "";
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

/**
 * Slack's answer to a call it took: where the message is, and its timestamp, new and unique to a message posted, as
 * the call gave it for an edit or a deletion.
 */
function taken(request: SlackRequest, sequence: number): FakeResponse {
    if (request.api === "auth.test") {
        return response(OK, JSON.stringify({ ok: true, team: WORKSPACE, user: "mod-action-notifications" }));
    }
    const seconds = Math.floor(request.sentAt / MS_PER_SECOND);
    const ts =
        request.api === "chat.postMessage"
            ? `${String(seconds)}.${String(sequence).padStart(TS_SEQUENCE_DIGITS, "0")}`
            : textOf(request.body["ts"]);
    return response(OK, JSON.stringify({ ok: true, channel: textOf(request.body["channel"]), ts }));
}

/** The messages posted with chat.postMessage. */
function messagesIn(requests: readonly SlackRequest[]): readonly SlackMessage[] {
    return requests.flatMap((request: SlackRequest): SlackMessage[] =>
        request.api === "chat.postMessage" && request.message !== undefined ? [request.message] : [],
    );
}

/** The edits asked for with chat.update. */
function updatesIn(requests: readonly SlackRequest[]): readonly SlackUpdate[] {
    return requests.flatMap((request: SlackRequest): SlackUpdate[] =>
        request.api === "chat.update" && request.message !== undefined
            ? [{ ...request.message, channel: textOf(request.body["channel"]), ts: textOf(request.body["ts"]) }]
            : [],
    );
}

/** The deletions asked for with chat.delete. */
function deletesIn(requests: readonly SlackRequest[]): readonly SlackDelete[] {
    return requests.flatMap((request: SlackRequest): SlackDelete[] =>
        request.api === "chat.delete"
            ? [{ channel: textOf(request.body["channel"]), ts: textOf(request.body["ts"]) }]
            : [],
    );
}

/** Waits `ms` on the test's clock; nothing for 0. */
async function after(ms: number): Promise<void> {
    if (ms > 0) {
        await new Promise<void>((resolve: () => void): void => {
            setTimeout(resolve, ms);
        });
    }
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
    /** How long each queued outcome takes, beside it. */
    const delays: number[] = [];
    return {
        requests,
        get messages(): readonly SlackMessage[] {
            return messagesIn(requests);
        },
        get updates(): readonly SlackUpdate[] {
            return updatesIn(requests);
        },
        get deletes(): readonly SlackDelete[] {
            return deletesIn(requests);
        },
        fetch: vi.fn(async (url: string, init?: FetchInit): Promise<FakeResponse> => {
            const api = url.slice(url.lastIndexOf("/") + 1);
            const body = bodyOf(init?.body);
            const request: SlackRequest = {
                url,
                api,
                method: init?.method,
                headers: init?.headers,
                body,
                message: messageIn(api, body),
                sentAt: Date.now(),
            };
            requests.push(request);
            await after(delays.shift() ?? 0);
            const outcome = outcomes.shift() ?? OK;
            if (outcome instanceof Error) {
                throw outcome;
            }
            return await Promise.resolve(responseFor(outcome, request, requests.length));
        }),
        respond: (...queued: readonly Outcome[]): void => {
            outcomes.push(...queued);
            delays.push(...queued.map((): number => 0));
        },
        respondSlowly: (afterMs: number, outcome: Outcome): void => {
            outcomes.push(outcome);
            delays.push(afterMs);
        },
    };
}
