import { vi } from "vitest";
import type { Mock } from "vitest";

/** A field of a Slack attachment. */
export type SlackField = Readonly<{ title: string; value: string | number; short: boolean }>;

/** The Slack incoming-webhook payload the app sends. */
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

export interface SlackRequest {
    readonly url: string;
    readonly method: string | undefined;
    readonly headers: unknown;
    readonly message: SlackMessage;
    /** Date.now() when the request was made. */
    readonly sentAt: number;
}

/** What the webhook does with one request: answer with an HTTP status, or fail with a network error. */
export type Outcome = number | Readonly<Error>;

type FetchInit = Readonly<{ method?: string; headers?: unknown; body?: unknown }>;

interface FakeResponse {
    readonly ok: boolean;
    readonly status: number;
    readonly statusText: string;
    readonly text: () => Promise<string>;
}

export interface FakeSlack {
    readonly requests: readonly SlackRequest[];
    readonly messages: readonly SlackMessage[];
    readonly fetch: Mock<(url: string, init?: FetchInit) => Promise<FakeResponse>>;
    /** Queues outcomes for the next requests, in order; requests after these get 200. */
    readonly respond: (...outcomes: readonly Outcome[]) => void;
}

const OK = 200;
const FIRST_NON_SUCCESS = 300;

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

function responseFor(status: number): FakeResponse {
    const ok = status >= OK && status < FIRST_NON_SUCCESS;
    return {
        ok,
        status,
        statusText: `status ${String(status)}`,
        text: async (): Promise<string> => await Promise.resolve(ok ? "ok" : "error"),
    };
}

/**
 * Replaces global `fetch` with a Slack webhook that answers 200 unless told otherwise. Responses are plain objects
 * rather than `Response`s, so reading a body needs no real I/O under fake timers.
 */
export function createFakeSlack(): FakeSlack {
    const requests: SlackRequest[] = [];
    const outcomes: (number | Error)[] = [];
    return {
        requests,
        get messages(): readonly SlackMessage[] {
            return requests.map((request: SlackRequest): SlackMessage => request.message);
        },
        fetch: vi.fn(async (url: string, init?: FetchInit): Promise<FakeResponse> => {
            requests.push({
                url,
                method: init?.method,
                headers: init?.headers,
                message: slackMessageIn(init?.body),
                sentAt: Date.now(),
            });
            const outcome = outcomes.shift() ?? OK;
            if (typeof outcome === "number") {
                return await Promise.resolve(responseFor(outcome));
            }
            throw outcome;
        }),
        respond: (...queued: readonly Outcome[]): void => {
            outcomes.push(...queued);
        },
    };
}
