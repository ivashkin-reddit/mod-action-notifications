import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "./support/app.js";
import { modActionEvent } from "./support/events.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";
import type { SlackRequest } from "./support/fakeSlack.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

const removal = modActionEvent({ action: "removelink", moderator: { name: "ModA" }, targetUser: { name: "Author" } });

/** Milliseconds after NOW at which each request reached Slack. */
function sendTimes(requests: readonly SlackRequest[]): number[] {
    return requests.map((request): number => request.sentAt - NOW.getTime());
}

describe("delivering a message to Slack", (): void => {
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
        "backs off 1, 2 and 4 seconds, then gives up and logs the last response",
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
        },
    );

    it.each([[400], [403], [404]])(
        "does not retry when Slack answers %i",
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
        },
    );

    it("retries a network error", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(new Error("ECONNRESET"));

        await app.fire("ModAction", removal);

        expect(sendTimes(app.slack.requests)).toStrictEqual([0, 1000]);
    });

    it("gives up after three retries of network errors and logs the error", TEST_OPTIONS, async (): Promise<void> => {
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
    });

    it(
        "does not retry when the request runs out of time, and logs a timeout",
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
