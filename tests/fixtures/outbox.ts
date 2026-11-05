import { vi } from "vitest";
import { NOW } from "./app.js";
import { createFakeContext, defaultSettings, WEBHOOK_URL } from "./fakeContext.js";
import type { FakeContext, ScheduledJob } from "./fakeContext.js";
import type { ZMember } from "./fakeRedis.js";
import { createFakeSlack } from "./fakeSlack.js";
import type { FakeSlack, SlackRequest } from "./fakeSlack.js";

/** What the Slack outbox's unit tests build it from, and the fakes behind it. */
export type OutboxFakes = Readonly<
    {
        dependencies: Readonly<{ webhookUrl: string } & Pick<FakeContext, "redis" | "scheduler">>;
        slack: FakeSlack;
    } & Pick<FakeContext, "redis" | "scheduler">
>;

/** Fake Redis, scheduler and Slack for an outbox, with the clock frozen at NOW. */
export function outboxFakes(): OutboxFakes {
    vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { context } = createFakeContext(defaultSettings());
    const slack = createFakeSlack();
    vi.stubGlobal("fetch", slack.fetch);
    return {
        dependencies: { webhookUrl: WEBHOOK_URL, redis: context.redis, scheduler: context.scheduler },
        redis: context.redis,
        scheduler: context.scheduler,
        slack,
    };
}

/** A message in the queue as an earlier send left it, queued `ago` ms before NOW. */
export function queued(text: string, ago = 0): ZMember {
    const queuedAt = NOW.getTime() - ago;
    return { member: JSON.stringify({ id: text, queuedAt, message: { text } }), score: queuedAt };
}

type Alert = Readonly<{ text: string }>;
type Quoting = Readonly<{ contentIds: readonly string[]; withoutQuotes: Alert }>;

/** An alert quoting the comment `contentId`, and what it quotes: the comment's ID, and the alert without the quote. */
export function alertQuoting(contentId: string): readonly [Alert, Quoting] {
    return [
        { text: `removed ${contentId}\n> what ${contentId} said` },
        { contentIds: [contentId], withoutQuotes: { text: `removed ${contentId}` } },
    ];
}

/** `alertQuoting(contentId)` in the queue as a send left it, queued `ago` ms before NOW. */
export function queuedQuoting(contentId: string, ago = 0): ZMember {
    const queuedAt = NOW.getTime() - ago;
    const [message, quoting] = alertQuoting(contentId);
    return { member: JSON.stringify({ id: contentId, queuedAt, message, ...quoting }), score: queuedAt };
}

export function texts(messages: FakeSlack["messages"]): string[] {
    return messages.map((sent): string => sent.text);
}

/** When each request reached Slack, in ms after NOW. */
export function sendTimes(requests: readonly SlackRequest[]): number[] {
    return requests.map((request: SlackRequest): number => request.sentAt - NOW.getTime());
}

/** When each scheduled drain is due, in ms after NOW. */
export function drains(jobs: readonly ScheduledJob[]): (number | undefined)[] {
    return jobs.map((job: ScheduledJob): number | undefined =>
        job.runAt === undefined ? undefined : job.runAt.getTime() - NOW.getTime(),
    );
}
