import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { NOW_SECONDS } from "../fixtures/messages.js";
import { queuedComment, queuedPost } from "../fixtures/queue.js";
import { keysBesidesBookkeeping } from "../fixtures/redisKeys.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const ONLY_REPORTED = { modqueueThreshold: 0, unmoderagedAgeHours: 0, reportedContentAgeHours: 24 };

describe("the old reported content alert", (): void => {
    it("lists the oldest reported items at least the age limit old", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, ONLY_REPORTED);
        app.context.reddit.reports = [queuedPost("a", 30), queuedComment("b", 72), queuedPost("c", 2)];

        await app.runJob("modqueueMonitor");

        expect(app.slack.messages).toStrictEqual([
            {
                text: "📣 Old Reported Content Alert: 2 reported items over 24h old",
                username: "Mod Action Notifications",
                icon_emoji: ":loudspeaker:",
                attachments: [
                    {
                        color: "#cc3300",
                        fields: [
                            {
                                title: "📌 Oldest Items (showing 2 of 2)",
                                value: [
                                    "• Comment (72h old): https://reddit.com/r/testsub/comments/p/c/b/",
                                    "• Post (30h old): https://reddit.com/r/testsub/comments/a/",
                                ].join("\n"),
                                short: false,
                            },
                        ],
                        footer: "Mod Action Notifications - Reports Monitor",
                        ts: NOW_SECONDS,
                    },
                ],
            },
        ]);
    });

    it("stays quiet when no reported item is that old", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, ONLY_REPORTED);
        app.context.reddit.reports = [queuedPost("a", 23)];

        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
    });

    it("is sent at most once an hour, throttled apart from the other alerts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, ONLY_REPORTED);
        app.context.reddit.reports = [queuedPost("a", 30)];

        await app.runJob("modqueueMonitor");
        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toHaveLength(1);
        expect(keysBesidesBookkeeping(app.context.redis)).toStrictEqual(["mod_actions:throttle:modqueue_reported"]);
        expect(app.context.redis.ttlSeconds("mod_actions:throttle:modqueue_reported")).toBe(3600);
    });

    it("goes to the alert channel", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...ONLY_REPORTED, alertChannel: "alerts" });
        app.context.reddit.reports = [queuedPost("a", 30)];

        await app.runJob("modqueueMonitor");

        expect(app.slack.messages[0]?.channel).toBe("#alerts");
    });

    it("is skipped, without reading the reports, when its age limit is 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, {
            modqueueThreshold: 0,
            unmoderagedAgeHours: 24,
            reportedContentAgeHours: 0,
        });
        app.context.reddit.reports = [queuedPost("a", 1000)];

        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.reddit.reportsAll).not.toHaveBeenCalled();
    });

    it("counts a failure to read the reports", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, ONLY_REPORTED);
        app.context.reddit.reportsAll.mockRejectedValue(new Error("reddit 503"));

        await app.runJob("modqueueMonitor");

        await expect(app.context.redis.get("scheduler_failure_count")).resolves.toBe("1");
    });
});

// Content in the modqueue was reported or held back by a filter, whatever its age; unmoderated content is content
// no moderator has reviewed yet.
describe("the unmoderated content alert", (): void => {
    it("reads Reddit's unmoderated listing, not the modqueue", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, {
            modqueueThreshold: 0,
            unmoderagedAgeHours: 24,
            reportedContentAgeHours: 0,
        });
        app.context.reddit.modQueue = [queuedPost("reported", 72)];

        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.reddit.modQueueAll).not.toHaveBeenCalled();
    });
});
