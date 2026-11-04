import { vi } from 'vitest';

/** The Slack incoming-webhook payload the app sends. */
export interface SlackMessage {
  text: string;
  username?: string;
  icon_emoji?: string;
  channel?: string;
  attachments?: {
    color: string;
    text?: string;
    fields?: { title: string; value: string | number; short: boolean }[];
    footer?: string;
    ts?: number;
    mrkdwn_in?: string[];
  }[];
}

export interface SlackRequest {
  url: string;
  method: string | undefined;
  headers: unknown;
  message: SlackMessage;
  /** Date.now() when the request was made. */
  sentAt: number;
}

/** What the webhook does with one request: answer with an HTTP status, or fail with a network error. */
export type Outcome = number | Error;

/**
 * Replaces global `fetch` with a Slack webhook that answers 200 unless told otherwise. Responses are plain
 * objects rather than `Response`s, so reading a body needs no real I/O under fake timers.
 */
export class FakeSlack {
  readonly requests: SlackRequest[] = [];
  private readonly outcomes: Outcome[] = [];

  readonly fetch = vi.fn(async (url: string, init?: { method?: string; headers?: unknown; body?: unknown }) => {
    this.requests.push({
      url,
      method: init?.method,
      headers: init?.headers,
      message: JSON.parse(String(init?.body)) as SlackMessage,
      sentAt: Date.now(),
    });
    const outcome = this.outcomes.shift() ?? 200;
    if (outcome instanceof Error) {
      throw outcome;
    }
    return {
      ok: outcome >= 200 && outcome < 300,
      status: outcome,
      statusText: `status ${outcome}`,
      text: async () => (outcome >= 200 && outcome < 300 ? 'ok' : 'error'),
    };
  });

  /** Queues outcomes for the next requests, in order; requests after these get 200. */
  respond(...outcomes: Outcome[]): void {
    this.outcomes.push(...outcomes);
  }

  get messages(): SlackMessage[] {
    return this.requests.map((request) => request.message);
  }
}
