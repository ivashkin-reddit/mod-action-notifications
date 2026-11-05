import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { modActionEvent } from "../fixtures/events.js";
import type { ScheduledJob } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { SlackRequest } from "../fixtures/fakeSlack.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

const removal = modActionEvent({ action: "removelink", moderator: { name: "ModA" }, targetUser: { name: "Author" } });

/**
 * The recovery drain a drain that finds work schedules, for in case it dies: after its lease (10 s budget, 1.1 s
 * pause, 30 s fetch timeout, 5 s margin) and a second more.
 */
const RECOVERY = new Date(NOW.getTime() + 47_100);

/** When each scheduled later drain of the outbox is due. */
function outboxJobs(
    app: Readonly<{ context: Readonly<{ scheduler: Readonly<{ jobs: readonly ScheduledJob[] }> }> }>,
): (Date | undefined)[] {
    return app.context.scheduler.jobs
        .filter((job: ScheduledJob): boolean => job.name === "slackOutbox")
        .map((job: ScheduledJob): Date | undefined => job.runAt);
}

/** The health log's line for Slack refusing alerts, with what Slack answered. */
function refusing(detail: string): string {
    return `[health] Slack is refusing alerts (${detail}), so they are dropped. Check the webhook URL in the app's settings, then use Test Slack Connection.`;
}

/** The health log's line for Slack not taking alerts, with why. */
function unreachable(detail: string): string {
    return `[health] Slack is not taking alerts (${detail}), so they wait in the queue. Alerts are dropped after a day, or beyond 500 waiting.`;
}

/** Milliseconds after NOW at which each request reached Slack. */
function sendTimes(requests: readonly SlackRequest[]): number[] {
    return requests.map((request): number => request.sentAt - NOW.getTime());
}

describe("delivering an alert to Slack", (): void => {
    it("sends it once when Slack accepts it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removal);

        expect(sendTimes(app.slack.requests)).toStrictEqual([0]);
        expect(console.error).not.toHaveBeenCalled();
    });

    it.each([[500], [503], [429]])(
        "retries after a second when Slack answers %i",
        TEST_OPTIONS,
        async (status): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(status);

            await app.fire("ModAction", removal);

            expect(sendTimes(app.slack.requests)).toStrictEqual([0, 1000]);
            expect(app.slack.messages[1]).toStrictEqual(app.slack.messages[0]);
            expect(console.error).not.toHaveBeenCalled();
        },
    );

    it(
        "backs off 1, 2 and 4 seconds, then logs Slack as not taking alerts and leaves the alert queued for 30 seconds",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(503, 503, 503, 503);

            await app.fire("ModAction", removal);

            expect(sendTimes(app.slack.requests)).toStrictEqual([0, 1000, 3000, 7000]);
            expect(console.warn).toHaveBeenCalledExactlyOnceWith(unreachable("HTTP 503: error"));
            expect(console.error).not.toHaveBeenCalled();
            expect(outboxJobs(app)).toStrictEqual([RECOVERY, new Date(NOW.getTime() + 7000 + 30_000)]);
        },
    );

    it.each([[400], [403], [404]])(
        "drops the alert, logging Slack as refusing alerts, when Slack answers %i",
        TEST_OPTIONS,
        async (status): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(status);

            await app.fire("ModAction", removal);

            expect(sendTimes(app.slack.requests)).toStrictEqual([0]);
            expect(console.error).toHaveBeenCalledExactlyOnceWith(refusing(`HTTP ${String(status)}: error`));
            expect(outboxJobs(app)).toStrictEqual([RECOVERY]);
        },
    );

    it("retries a network error", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(new Error("ECONNRESET"));

        await app.fire("ModAction", removal);

        expect(sendTimes(app.slack.requests)).toStrictEqual([0, 1000]);
    });

    it(
        "logs Slack as not taking alerts after three retries of a network error, and leaves the alert queued",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            const error = new Error("ECONNRESET");
            app.slack.respond(error, error, error, error);

            await app.fire("ModAction", removal);

            expect(sendTimes(app.slack.requests)).toStrictEqual([0, 1000, 3000, 7000]);
            expect(console.warn).toHaveBeenCalledExactlyOnceWith(unreachable("ECONNRESET"));
        },
    );

    it(
        "leaves the alert queued at once, logging Slack as not taking alerts, when the request runs out of time",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(new Error("context deadline exceeded"));

            await app.fire("ModAction", removal);

            expect(sendTimes(app.slack.requests)).toStrictEqual([0]);
            expect(console.warn).toHaveBeenCalledExactlyOnceWith(unreachable("context deadline exceeded"));
            expect(outboxJobs(app)).toStrictEqual([RECOVERY, new Date(NOW.getTime() + 30_000)]);
        },
    );

    it("retries a failure that is not an Error, and logs it as said", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.fetch.mockRejectedValue("offline");

        await app.fire("ModAction", removal);

        expect(app.slack.fetch).toHaveBeenCalledTimes(4);
        expect(console.warn).toHaveBeenCalledExactlyOnceWith(unreachable("offline"));
    });
});
