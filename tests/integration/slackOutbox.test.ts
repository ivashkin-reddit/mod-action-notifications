import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { ZMember } from "../fixtures/fakeRedis.js";
import type { ScheduledJob } from "../fixtures/fakeScheduler.js";
import type { SlackRequest } from "../fixtures/fakeSlack.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 10_000 };
const QUEUE_KEY = "slack_outbox";
/** How long the outbox lease lasts: a drain's 10 s budget, a 1.1 s pause, the 30 s fetch timeout and a 5 s margin. */
const LEASE_MS = 46_100;
/** The recovery drain a drain that finds work schedules, a second after its lease would expire. */
const RECOVERY = new Date(NOW.getTime() + LEASE_MS + 1000);
const DAY = 86_400_000;

/** User`index`'s post removed by ModA. */
function removal(index: number): ReturnType<typeof removedPost> {
    return removedPost({ id: `ModAction_${String(index)}`, targetUser: { name: `User${String(index)}` } });
}

/** Fires removals 0 to count - 1 at once, as Devvit delivers a burst of mod actions. */
async function burst(fire: App["fire"], count: number): Promise<void> {
    await Promise.all(
        Array.from({ length: count }, async (_unused: unknown, index: number): Promise<void> => {
            await fire("ModAction", removal(index));
        }),
    );
}

/** The users whose removals reached Slack, in the order they did. */
function deliveredUsers(requests: readonly SlackRequest[]): (string | undefined)[] {
    return requests.map(
        (request: SlackRequest): string | undefined =>
            /u\/(?<user>User\d+)>/u.exec(request.message.attachments?.[0]?.text ?? "")?.groups?.["user"],
    );
}

/** A sorted copy. */
function sorted(values: readonly (string | undefined)[]): (string | undefined)[] {
    return [...values].sort((first, second): number => String(first).localeCompare(String(second)));
}

function outboxJobs(jobs: readonly ScheduledJob[]): ScheduledJob[] {
    return jobs.filter((job: ScheduledJob): boolean => job.name === "slackOutbox");
}

/** A queued message, as a drain that did not finish would have left it. */
function queued(queuedAt: number, text: string): ZMember {
    return { member: JSON.stringify({ id: text, queuedAt, message: { text } }), score: queuedAt };
}

describe("the Slack outbox", (): void => {
    // Slack takes about one message a second from a webhook; a burst sent at once is mostly rate-limited away.
    it(
        "delivers a burst in full, one message at least 1.1 seconds after another",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { flagUnknownModerators: false });

            await burst(app.fire, 5);

            const times = app.slack.requests.map((request: SlackRequest): number => request.sentAt);

            expect(sorted(deliveredUsers(app.slack.requests))).toStrictEqual([
                "User0",
                "User1",
                "User2",
                "User3",
                "User4",
            ]);
            expect(
                times.slice(1).map((time: number, index: number): number => time - (times[index] ?? 0)),
            ).toStrictEqual([1100, 1100, 1100, 1100]);
            expect(
                app.context.redis.keys().filter((key: string): boolean => key.startsWith("slack_outbox")),
            ).toStrictEqual(["slack_outbox_last_sent", "slack_outbox_recovery_scheduled"]);
        },
    );

    it("waits as long as Slack's Retry-After asks before sending again", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond({ retryAfterSeconds: 3 });

        await app.fire("ModAction", removal(0));

        expect(app.slack.requests.map((request: SlackRequest): number => request.sentAt - NOW.getTime())).toStrictEqual(
            [0, 3000],
        );
        expect(console.error).not.toHaveBeenCalled();
    });

    it("hands what one drain cannot send in its time to a scheduled drain", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { flagUnknownModerators: false });

        await burst(app.fire, 12);

        expect(app.slack.requests.length).toBeLessThan(12);
        expect(
            outboxJobs(app.context.scheduler.jobs).map((job: ScheduledJob): Date | undefined => job.runAt),
            // The last delivery starts before the 10-second budget runs out, at 11 s; the drain continues a second later.
        ).toStrictEqual([RECOVERY, new Date(NOW.getTime() + 12_000)]);

        await app.runJob("slackOutbox");

        expect(deliveredUsers(app.slack.requests)).toHaveLength(12);
        expect(new Set(deliveredUsers(app.slack.requests)).size).toBe(12);
    });

    it(
        "delivers alerts queued while Slack was failing once a scheduled drain runs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(503, 503, 503, 503, 503, 503, 503, 503);

            await app.fire("ModAction", removal(0));
            await app.fire("ModAction", removal(1));

            expect(
                outboxJobs(app.context.scheduler.jobs).map((job: ScheduledJob): Date | undefined => job.runAt),
            ).toStrictEqual([RECOVERY, new Date(NOW.getTime() + 7000 + 30_000)]);
            expect(app.slack.requests).toHaveLength(8);

            await app.runJob("slackOutbox");

            expect(deliveredUsers(app.slack.requests.slice(8))).toStrictEqual(["User0", "User1"]);
            expect(app.context.redis.keys()).not.toContain(QUEUE_KEY);
        },
    );

    it("does nothing when a scheduled drain finds the queue empty", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.runJob("slackOutbox");

        expect(app.slack.requests).toStrictEqual([]);
    });

    it("waits, without delivering, while no webhook is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: "" });
        await app.context.redis.zAdd(QUEUE_KEY, queued(NOW.getTime(), "queued"));

        await app.runJob("slackOutbox");

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.redis.keys()).toContain(QUEUE_KEY);
    });

    it("drops, logged, a message queued over a day ago", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.context.redis.zAdd(QUEUE_KEY, queued(NOW.getTime() - DAY - 1, "stale"));
        await app.context.redis.zAdd(QUEUE_KEY, queued(NOW.getTime(), "fresh"));

        await app.runJob("slackOutbox");

        expect(app.slack.messages.map((message): string => message.text)).toStrictEqual(["fresh"]);
        expect(console.error).toHaveBeenCalledWith(
            "[health] Alerts are being dropped after waiting a day without reaching Slack.",
        );
    });

    it("drops, logged, a queued member it cannot read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.context.redis.zAdd(QUEUE_KEY, { member: "not json", score: NOW.getTime() });

        await app.runJob("slackOutbox");

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.redis.keys()).not.toContain(QUEUE_KEY);
        expect(console.warn).toHaveBeenCalledWith("[outbox] Dropped a queued alert it could not read");
    });

    it("keeps at most 500 messages, dropping the oldest, logged", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.zAdd.mockClear();
        await Promise.all(
            Array.from({ length: 500 }, async (_unused: unknown, index: number): Promise<void> => {
                await app.context.redis.zAdd(
                    QUEUE_KEY,
                    queued(NOW.getTime() - 1000 + index, `queued ${String(index)}`),
                );
            }),
        );

        await app.fire("ModAction", removal(0));

        expect(console.error).toHaveBeenCalledWith(
            "[health] The alert queue is full: 500 alerts are waiting, so the oldest are dropped as new ones come.",
        );
        expect(app.slack.messages[0]?.text).toBe("queued 1");
    });

    it("sends an alert straight to Slack when it cannot be queued", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { flagUnknownModerators: false });
        const error = new Error("redis down");
        app.context.redis.zAdd.mockRejectedValue(error);

        await app.fire("ModAction", removal(0));

        expect(deliveredUsers(app.slack.requests)).toStrictEqual(["User0"]);
        expect(console.warn).toHaveBeenCalledWith(
            "[outbox] Could not queue an alert, so sent it straight to Slack:",
            error,
        );
    });

    it("keeps an alert queued, logged, when the queue cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { flagUnknownModerators: false });
        const error = new Error("redis down");
        app.context.redis.zRange.mockRejectedValue(error);

        await app.fire("ModAction", removal(0));

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.redis.keys()).toContain(QUEUE_KEY);
        expect(console.error).toHaveBeenCalledWith(
            "[outbox] Could not deliver the queued alerts; they wait for the next drain:",
            error,
        );
    });

    it(
        "leaves the queue for a scheduled drain when Slack asks to wait longer than the drain has",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond({ retryAfterSeconds: 60 });

            await app.fire("ModAction", removal(0));

            expect(app.slack.requests).toHaveLength(1);
            expect(
                outboxJobs(app.context.scheduler.jobs).map((job: ScheduledJob): Date | undefined => job.runAt),
            ).toStrictEqual([RECOVERY, new Date(NOW.getTime() + 60_000)]);
        },
    );

    // The drain looked, found nothing, and let go of the lease just as another handler queued a message and found
    // the lease held: the drain looks once more after letting go, and leaves what it finds to a later drain, so that
    // one trigger's delivering is bounded however fast messages arrive.
    it("hands a message queued as a drain finished to a later drain", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.context.redis.zAdd(QUEUE_KEY, queued(NOW.getTime(), "late"));
        // The drain looks three times before it lets go: as it takes the lease, to deliver, and for messages quoting
        // deleted content.
        app.context.redis.zRange.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);

        await app.runJob("slackOutbox");

        expect(app.slack.messages).toStrictEqual([]);
        expect(
            outboxJobs(app.context.scheduler.jobs).map((job: ScheduledJob): Date | undefined => job.runAt),
        ).toStrictEqual([new Date(NOW.getTime() + 1000)]);

        await app.runJob("slackOutbox");

        expect(app.slack.messages.map((message): string => message.text)).toStrictEqual(["late"]);
    });
});
