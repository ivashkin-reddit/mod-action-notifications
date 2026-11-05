import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { ScheduledJob } from "../fixtures/fakeScheduler.js";
import type { SlackRequest } from "../fixtures/fakeSlack.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 10_000 };
const LEASE_KEY = "slack_outbox_lease";
/** How long the outbox lease lasts: a drain's 10 s budget, a 1.1 s pause, the 30 s fetch timeout and a 5 s margin. */
const LEASE_MS = 46_100;
/** The recovery drain a drain that finds work schedules, a second after its lease would expire. */
const RECOVERY = new Date(NOW.getTime() + LEASE_MS + 1000);

/** User`index`'s post removed by ModA. */
function removal(index: number): ReturnType<typeof removedPost> {
    return removedPost({ id: `ModAction_${String(index)}`, targetUser: { name: `User${String(index)}` } });
}

/** The users whose removals reached Slack, in the order they did. */
function deliveredUsers(requests: readonly SlackRequest[]): (string | undefined)[] {
    return requests.map(
        (request: SlackRequest): string | undefined =>
            /u\/(?<user>User\d+)>/u.exec(request.message?.attachments?.[0]?.text ?? "")?.groups?.["user"],
    );
}

function outboxJobs(jobs: readonly ScheduledJob[]): ScheduledJob[] {
    return jobs.filter((job: ScheduledJob): boolean => job.name === "slackOutbox");
}

describe("recovering the Slack outbox", (): void => {
    // The platform ends a handler that runs too long, and a Slack request can take up to Devvit's 30-second fetch
    // timeout: a drain can die holding the lease, leaving what other handlers queued for it to deliver.
    it("delivers what a drain that died left queued, once its lease expires", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.context.redis.set(LEASE_KEY, "a drain that died", {
            expiration: new Date(NOW.getTime() + LEASE_MS),
        });

        await app.fire("ModAction", removal(0));

        expect(app.slack.requests).toStrictEqual([]);
        expect(
            outboxJobs(app.context.scheduler.jobs).map((job: ScheduledJob): Date | undefined => job.runAt),
        ).toStrictEqual([RECOVERY]);

        await app.advance(LEASE_MS + 1000);
        await app.runJob("slackOutbox");

        expect(deliveredUsers(app.slack.requests)).toStrictEqual(["User0"]);
    });

    it("schedules nothing more when a recovery drain finds the queue empty", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("ModAction", removal(0));
        await app.advance(LEASE_MS + 1000);

        await app.runJob("slackOutbox");

        expect(outboxJobs(app.context.scheduler.jobs)).toHaveLength(1);
        // Only when Slack was last sent a message, which expires a minute after, besides the record of where the alert
        // went, which redactedAlerts.test.ts covers.
        expect(
            app.context.redis
                .keys()
                .filter(
                    (key: string): boolean => key.startsWith("slack_outbox") && !key.startsWith("slack_outbox_sent"),
                ),
        ).toStrictEqual(["slack_outbox_last_sent"]);
    });

    it("lets its lease outlast the longest a drain can run", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.set.mockClear();

        await app.fire("ModAction", removal(0));

        expect(app.context.redis.set).toHaveBeenCalledWith(LEASE_KEY, NOW.getTime().toString(), {
            nx: true,
            expiration: new Date(NOW.getTime() + 10_000 + 1100 + 30_000 + 5000),
        });
    });
});
