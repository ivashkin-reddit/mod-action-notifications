import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { CHANNEL } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { monitorJobs } from "../fixtures/jobs.js";
import { NOW_SECONDS } from "../fixtures/messages.js";
import { queuedComment, queuedPost } from "../fixtures/queue.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
/** Every other monitor alert off, so a run alerts about these queues alone. */
const ONLY_THESE = { modqueueThreshold: 0, unmoderagedAgeHours: 0, reportedContentAgeHours: 0 };

/** The queue-size alert's fields for a queue of one post and one comment, at a threshold of 2. */
const FIELDS = [
    { title: "📋 Queue Size", value: "2", short: true },
    { title: "📝 Posts", value: "1", short: true },
    { title: "💬 Comments", value: "1", short: true },
    { title: "🎯 Threshold", value: "2", short: true },
];

function sizeAlert(text: string): unknown {
    return {
        text,
        username: "Mod Action Notifications",
        icon_emoji: ":warning:",
        channel: CHANNEL,
        attachments: [
            {
                color: "#ff9900",
                fields: FIELDS,
                footer: "Mod Action Notifications - Modqueue Monitor",
                ts: NOW_SECONDS,
            },
        ],
    };
}

describe("the spam queue", (): void => {
    it("alerts when it holds at least its threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...ONLY_THESE, spamQueueThreshold: 2 });
        app.context.reddit.spam = [queuedPost("a", 1), queuedComment("b", 1)];

        await app.runJob("modqueueMonitor");

        expect(app.context.reddit.getSpam).toHaveBeenCalledWith({ type: "all" });
        expect(app.slack.messages).toStrictEqual([sizeAlert("⚠️ Spam Queue Alert: 2 items pending")]);
    });

    it("alerts at most once an hour", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...ONLY_THESE, spamQueueThreshold: 2 });
        app.context.reddit.spam = [queuedPost("a", 1), queuedComment("b", 1)];

        await app.runJob("modqueueMonitor");
        await app.runJob("modqueueMonitor");

        expect(app.slack.messages).toHaveLength(1);
        expect(app.context.redis.ttlSeconds("mod_actions:throttle:modqueue_spam")).toBe(3600);
    });
});

describe("the edited queue", (): void => {
    it("alerts when it holds at least its threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...ONLY_THESE, editedQueueThreshold: 2 });
        app.context.reddit.edited = [queuedPost("a", 1), queuedComment("b", 1)];

        await app.runJob("modqueueMonitor");

        expect(app.context.reddit.getEdited).toHaveBeenCalledWith({ type: "all" });
        expect(app.slack.messages).toStrictEqual([sizeAlert("⚠️ Edited Queue Alert: 2 items pending")]);
        expect(app.context.redis.ttlSeconds("mod_actions:throttle:modqueue_edited")).toBe(3600);
    });
});

describe("the spam and edited queue thresholds", (): void => {
    it("leave both queues unread at 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, ONLY_THESE);

        await app.runJob("modqueueMonitor");

        expect(app.context.reddit.getSpam).not.toHaveBeenCalled();
        expect(app.context.reddit.getEdited).not.toHaveBeenCalled();
    });

    it("keep the monitor scheduled when they are the only alert on", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...ONLY_THESE, editedQueueThreshold: 5 });

        await app.fire("AppInstall", { type: "AppInstall" });

        expect(monitorJobs(app.context.scheduler.jobs)).toHaveLength(1);
    });
});
