import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "./support/app.js";
import { modActionEvent } from "./support/events.js";
import type { ScheduledJob } from "./support/fakeContext.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";
import type { SlackRequest } from "./support/fakeSlack.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

const removal = modActionEvent({ action: "removelink", moderator: { name: "ModA" }, targetUser: { name: "Author" } });

/** When each scheduled later drain of the outbox is due. */
function outboxJobs(
    app: Readonly<{ context: Readonly<{ scheduler: Readonly<{ jobs: readonly ScheduledJob[] }> }> }>,
): (Date | undefined)[] {
    return app.context.scheduler.jobs
        .filter((job: ScheduledJob): boolean => job.name === "slackOutbox")
        .map((job: ScheduledJob): Date | undefined => job.runAt);
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
        "backs off 1, 2 and 4 seconds, then logs the last response and leaves the alert queued for 30 seconds",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(503, 503, 503, 503);

            await app.fire("ModAction", removal);

            expect(sendTimes(app.slack.requests)).toStrictEqual([0, 1000, 3000, 7000]);
            expect(console.error).toHaveBeenCalledExactlyOnceWith(
                "Slack webhook request failed - verify webhook URL is correct:",
                {
                    status: 503,
                    statusText: "status 503",
                    responseText: "error",
                    troubleshooting:
                        "Check: 1) Webhook URL is valid, 2) Slack workspace permissions, 3) Network connectivity",
                },
            );
            expect(outboxJobs(app)).toStrictEqual([new Date(NOW.getTime() + 7000 + 30_000)]);
        },
    );

    it.each([[400], [403], [404]])(
        "drops the alert, logged, when Slack answers %i",
        TEST_OPTIONS,
        async (status): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(status);

            await app.fire("ModAction", removal);

            expect(sendTimes(app.slack.requests)).toStrictEqual([0]);
            expect(console.error).toHaveBeenCalledWith(
                "Slack webhook request failed - verify webhook URL is correct:",
                expect.objectContaining({ status }),
            );
            expect(outboxJobs(app)).toStrictEqual([]);
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
        "logs network errors after three retries, and leaves the alert queued",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            const error = new Error("ECONNRESET");
            app.slack.respond(error, error, error, error);

            await app.fire("ModAction", removal);

            expect(sendTimes(app.slack.requests)).toStrictEqual([0, 1000, 3000, 7000]);
            expect(console.error).toHaveBeenCalledExactlyOnceWith(
                "Error sending Slack message - check webhook URL and network connectivity:",
                error,
            );
        },
    );

    it(
        "leaves the alert queued at once, logging a timeout, when the request runs out of time",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(new Error("context deadline exceeded"));

            await app.fire("ModAction", removal);

            expect(sendTimes(app.slack.requests)).toStrictEqual([0]);
            expect(console.error).toHaveBeenCalledExactlyOnceWith(
                "Slack webhook request timed out - Slack may be experiencing delays or webhook URL may be incorrect",
                {
                    channel: "default",
                    error: "context deadline exceeded",
                    troubleshooting: "Verify webhook URL in settings and check Slack status at status.slack.com",
                },
            );
            expect(outboxJobs(app)).toHaveLength(1);
        },
    );

    it("logs repeated timeouts as a timeout, naming the channel", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { notificationChannel: "mod-log" });
        const error = new Error("socket timeout");
        app.slack.respond(error, error, error, error);

        await app.fire("ModAction", removal);

        expect(sendTimes(app.slack.requests)).toHaveLength(4);
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
            "Slack webhook request timed out - Slack may be experiencing delays or webhook URL may be incorrect",
            expect.objectContaining({ channel: "#mod-log", error: "socket timeout" }),
        );
    });

    it("retries and logs a failure that is not an Error", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.fetch.mockRejectedValue("offline");

        await app.fire("ModAction", removal);

        expect(app.slack.fetch).toHaveBeenCalledTimes(4);
        expect(console.error).toHaveBeenCalledExactlyOnceWith(
            "Error sending Slack message - check webhook URL and network connectivity:",
            "offline",
        );
    });
});
