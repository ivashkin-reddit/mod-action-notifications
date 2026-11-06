import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { CHANNEL } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lastField, NOW_SECONDS } from "../fixtures/messages.js";
import { freshQueue, queuedComment, queuedPost } from "../fixtures/queue.js";
import { keysBesidesBookkeeping } from "../fixtures/redisKeys.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const FAILURE_KEY = "scheduler_failure_count";
const HOUR = 3_600_000;

describe("the modqueue monitor", (): void => {
    it("does nothing without a bot token", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { connectedToken: undefined });

        await app.runJob("modqueueMonitor");

        expect(app.context.reddit.getCurrentSubreddit).not.toHaveBeenCalled();
        expect(app.slack.requests).toStrictEqual([]);
    });

    it("alerts when the queue reaches the size threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 3, unmoderagedAgeHours: 0 });
        app.context.reddit.modQueue = [queuedPost("a", 1), queuedPost("b", 1), queuedComment("c", 1)];

        await app.runJob("modqueueMonitor");

        expect(app.context.reddit.getModQueue).toHaveBeenCalledWith({ type: "all" });
        expect(app.slack.messages).toStrictEqual([
            {
                text: "⚠️ Modqueue Alert: 3 items pending",
                channel: CHANNEL,
                attachments: [
                    {
                        color: "#ff9900",
                        fields: [
                            { title: "📋 Queue Size", value: "3", short: true },
                            { title: "📝 Posts", value: "2", short: true },
                            { title: "💬 Comments", value: "1", short: true },
                            { title: "🎯 Threshold", value: "3", short: true },
                        ],
                        footer: "Mod Action Notifications - Modqueue Monitor",
                        ts: NOW_SECONDS,
                    },
                ],
            },
        ]);
    });

    it("stays quiet below the size threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 3 });
        app.context.reddit.modQueue = freshQueue(2);

        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
    });

    // Two monitor jobs can run at once (one left over from an interrupted setup, say).
    it("sends the size alert once when two runs overlap", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 1 });
        app.context.reddit.modQueue = freshQueue(1);

        await Promise.all([app.runJob("modqueueMonitor"), app.runJob("modqueueMonitor")]);

        expect(app.slack.requests).toHaveLength(1);
    });

    it("sends the size alert at most once an hour", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 1 });
        app.context.reddit.modQueue = freshQueue(1);

        await app.runJob("modqueueMonitor");
        await app.advance(HOUR - 1);
        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toHaveLength(1);
        expect(app.context.redis.keys()).toContain("mod_actions:throttle:modqueue_size");

        await app.advance(1);
        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toHaveLength(2);
    });

    it("never alerts on size when the size threshold is 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0 });
        app.context.reddit.modQueue = freshQueue(500);

        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
    });

    it.each([
        ["3", "3"],
        [3.9, "3"],
        ["not a number", "50"],
        [null, "50"],
    ])("reads a size threshold setting of %j as %s", TEST_OPTIONS, async (threshold, expected): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: threshold, unmoderagedAgeHours: 0 });
        app.context.reddit.modQueue = freshQueue(60);

        await app.runJob("modqueueMonitor");

        expect(lastField(app.slack.messages[0])).toStrictEqual({
            title: "🎯 Threshold",
            value: expected,
            short: true,
        });
    });

    it("treats a negative size threshold as 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: -4, unmoderagedAgeHours: 0 });
        app.context.reddit.modQueue = freshQueue(60);

        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
    });

    it("lists the five oldest items waiting longer than the age limit", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 24 });
        app.context.reddit.unmoderated = [
            queuedPost("a", 30),
            queuedComment("b", 25),
            queuedPost("c", 2),
            queuedPost("d", 48),
            queuedComment("e", 24),
            queuedPost("f", 26),
            queuedPost("g", 27),
        ];

        await app.runJob("modqueueMonitor");

        expect(app.slack.messages).toStrictEqual([
            {
                text: "⏰ Unmoderated Content Alert: 6 items over 24h old",
                channel: CHANNEL,
                attachments: [
                    {
                        color: "#ff6600",
                        fields: [
                            {
                                title: "📌 Oldest Items (showing 5 of 6)",
                                value: [
                                    "• Post (48h old): https://reddit.com/r/testsub/comments/d/",
                                    "• Post (30h old): https://reddit.com/r/testsub/comments/a/",
                                    "• Post (27h old): https://reddit.com/r/testsub/comments/g/",
                                    "• Post (26h old): https://reddit.com/r/testsub/comments/f/",
                                    "• Comment (25h old): https://reddit.com/r/testsub/comments/p/c/b/",
                                ].join("\n"),
                                short: false,
                            },
                        ],
                        footer: "Mod Action Notifications - Unmoderated Monitor",
                        ts: NOW_SECONDS,
                    },
                ],
            },
        ]);
    });

    it("stays quiet when nothing has waited as long as the age limit", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 24 });
        app.context.reddit.unmoderated = [queuedPost("a", 23), queuedComment("b", 1)];

        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
    });

    it(
        "skips the age check, without reading the listing, when the age limit is 0",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0 });
            app.context.reddit.unmoderated = [queuedPost("a", 1000)];

            await app.runJob("modqueueMonitor");

            expect(app.slack.requests).toStrictEqual([]);
            expect(app.context.reddit.unmoderatedAll).not.toHaveBeenCalled();
        },
    );

    it("throttles the size and age alerts separately, each to once an hour", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 1, unmoderagedAgeHours: 1 });
        app.context.reddit.modQueue = [queuedPost("a", 5)];
        app.context.reddit.unmoderated = [queuedPost("a", 5)];

        await app.runJob("modqueueMonitor");
        await app.runJob("modqueueMonitor");

        expect(app.slack.messages.map((message): string => message.text)).toStrictEqual([
            "⚠️ Modqueue Alert: 1 items pending",
            "⏰ Unmoderated Content Alert: 1 items over 1h old",
        ]);
        expect(keysBesidesBookkeeping(app.context.redis)).toStrictEqual([
            "mod_actions:throttle:modqueue_size",
            "mod_actions:throttle:modqueue_unmoderated",
        ]);
        // An hour from when it was claimed: the second alert then waited 1.1 s to keep Slack's pace.
        expect(app.context.redis.ttlSeconds("mod_actions:throttle:modqueue_unmoderated")).toBe(3600 - 1.1);
    });

    it("sends both alerts to the alert channel", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 1, unmoderagedAgeHours: 1, alertChannel: "#alerts" });
        app.context.reddit.modQueue = [queuedPost("a", 5)];
        app.context.reddit.unmoderated = [queuedPost("a", 5)];

        await app.runJob("modqueueMonitor");

        expect(app.slack.messages.map((message): string | undefined => message.channel)).toStrictEqual([
            "#alerts",
            "#alerts",
        ]);
    });

    // The Alert Channel setting's help text: "uses main channel if empty".
    it(
        "sends its alerts to the notification channel when no alert channel is set",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { modqueueThreshold: 1, notificationChannel: "mod-log" });
            app.context.reddit.modQueue = [queuedPost("a", 5)];

            await app.runJob("modqueueMonitor");

            expect(app.slack.messages.map((message): string | undefined => message.channel)).toStrictEqual([
                "#mod-log",
            ]);
        },
    );

    it("clears the failure count after a successful run", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.seed(FAILURE_KEY, "2");

        await app.runJob("modqueueMonitor");

        expect(app.context.redis.keys()).not.toContain(FAILURE_KEY);
    });

    it("still succeeds when clearing the failure count fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.del.mockRejectedValue(new Error("redis down"));

        await expect(app.runJob("modqueueMonitor")).resolves.toBeUndefined();
    });
});
