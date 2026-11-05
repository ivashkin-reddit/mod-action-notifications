import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { NOW_SECONDS } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const FAILURE_KEY = "scheduler_failure_count";
const HOUR = 3_600_000;

/** The health log's line for the monitor failing, with why. */
function failing(reason: string): string {
    return `[health] The modqueue monitor is failing (${reason}), so no modqueue alerts are sent until it recovers.`;
}

describe("a failing modqueue monitor run", (): void => {
    it("logs the monitor as failing, and counts the failure for an hour", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const error = new Error("reddit 503");
        app.context.reddit.modQueueAll.mockRejectedValue(error);

        await app.runJob("modqueueMonitor");

        expect(console.error).toHaveBeenCalledWith(failing("reddit 503"));
        await expect(app.context.redis.get(FAILURE_KEY)).resolves.toBe("1");
        expect(app.context.redis.ttlSeconds(FAILURE_KEY)).toBe(3600);
        expect(app.slack.requests).toStrictEqual([]);
    });

    it(
        "alerts Slack on the third failure in a row, then counts again from zero",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.reddit.modQueueAll.mockRejectedValue(new Error("reddit 503"));

            for (let run = 0; run < 6; run += 1) {
                await app.runJob("modqueueMonitor");
            }

            const alert = {
                text: "⚠️ Critical: Modqueue Monitoring Failed 3 Times",
                username: "Mod Action Notifications",
                icon_emoji: ":warning:",
                attachments: [
                    {
                        color: "#ff0000",
                        fields: [
                            { title: "❌ Status", value: "Scheduler job has failed repeatedly", short: true },
                            { title: "🔢 Failure Count", value: "3", short: true },
                            { title: "🔍 Error", value: "reddit 503", short: false },
                            {
                                title: "⚙️ Action Required",
                                value: "Check bot configuration and permissions",
                                short: false,
                            },
                        ],
                        footer: "Mod Action Notifications - Scheduler Monitor",
                        ts: NOW_SECONDS,
                    },
                ],
            };

            expect(app.slack.messages).toStrictEqual([alert, alert]);
            expect(app.context.redis.keys()).not.toContain(FAILURE_KEY);
        },
    );

    it(
        "sends the failure alert to the alert channel, naming an error without a message as unknown",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { alertChannel: "alerts" });
            app.context.reddit.modQueueAll.mockRejectedValue(new Error(""));

            for (let run = 0; run < 3; run += 1) {
                await app.runJob("modqueueMonitor");
            }

            const [message] = app.slack.messages;

            expect(message?.channel).toBe("#alerts");
            expect(message?.attachments?.[0]?.fields?.[2]).toStrictEqual({
                title: "🔍 Error",
                value: "Unknown error",
                short: false,
            });
        },
    );

    it("forgets failures an hour after the last one", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modQueueAll.mockRejectedValue(new Error("reddit 503"));

        await app.runJob("modqueueMonitor");

        await app.advance(HOUR);

        await app.runJob("modqueueMonitor");
        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
        await expect(app.context.redis.get(FAILURE_KEY)).resolves.toBe("2");
    });

    it("counts afresh after a successful run", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modQueueAll.mockRejectedValueOnce(new Error("one")).mockRejectedValueOnce(new Error("two"));

        await app.runJob("modqueueMonitor");
        await app.runJob("modqueueMonitor");

        await app.runJob("modqueueMonitor");
        app.context.reddit.modQueueAll.mockRejectedValueOnce(new Error("three"));

        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
        await expect(app.context.redis.get(FAILURE_KEY)).resolves.toBe("1");
    });

    it("counts a failure that is not an Error", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modQueueAll.mockRejectedValue("reddit said no");

        await app.runJob("modqueueMonitor");

        await expect(app.context.redis.get(FAILURE_KEY)).resolves.toBe("1");
    });

    // The failure alert says monitoring is not working, which a subreddit Reddit cannot look up means as much as a
    // listing it cannot read.
    it("counts a failure to look up the subreddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("reddit down");
        app.context.reddit.getCurrentSubreddit.mockRejectedValue(failure);

        await app.runJob("modqueueMonitor");

        await expect(app.context.redis.get(FAILURE_KEY)).resolves.toBe("1");
        expect(console.error).toHaveBeenCalledWith(failing("reddit down"));
    });

    it("still reports the failure when counting it fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modQueueAll.mockRejectedValue(new Error("reddit 503"));
        app.context.redis.incrBy.mockRejectedValue(new Error("redis down"));

        await app.runJob("modqueueMonitor");

        expect(console.warn).toHaveBeenCalledWith(
            "[modqueue] Could not count the failed monitor run:",
            new Error("redis down"),
        );
    });
});
