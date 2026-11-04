import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "./support/app.js";
import { bigPost, DeletionReason, DeletionSource, postCreateEvent, userDeletion } from "./support/events.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";
import { lastField } from "./support/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const CACHE_KEY = "post_score:t3_big";

describe("a user deleting a remembered post", (): void => {
    it("alerts Slack when the post had at least the threshold score", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("PostCreate", postCreateEvent({ post: bigPost(150) }));

        await app.fire("PostDelete", userDeletion());

        // The reason is Devvit's numeric DeletionReason, sent as it is.
        expect(app.slack.messages).toStrictEqual([
            {
                text: "🗑️ User Deleted High-Score Post: 150 upvotes",
                username: "Reddit Mod Bot",
                icon_emoji: ":wastebasket:",
                attachments: [
                    {
                        color: "#cc0000",
                        fields: [
                            { title: "📝 Title", value: "Big post", short: false },
                            { title: "👤 Author", value: "/u/Unknown", short: true },
                            { title: "⬆️ Score", value: "150", short: true },
                            { title: "🗑️ Reason", value: DeletionReason.OTHER, short: true },
                            { title: "📍 Subreddit", value: "/r/Unknown", short: true },
                            {
                                title: "🔗 Link (may be dead)",
                                value: "https://reddit.com/r/testsub/comments/big/big_post/",
                                short: false,
                            },
                            { title: "⏰ Deleted At", value: "2026-11-04T13:00:00.000Z", short: true },
                        ],
                        footer: "Reddit Mod Action Bot - Post Deletion Monitor",
                        ts: Math.floor(NOW.getTime() / 1000),
                    },
                ],
            },
        ]);
    });

    it("forgets the post once it has alerted", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("PostCreate", postCreateEvent({ post: bigPost(150) }));

        await app.fire("PostDelete", userDeletion());
        await app.fire("PostDelete", userDeletion());

        expect(app.slack.requests).toHaveLength(1);
        expect(app.context.redis.keys()).toStrictEqual([]);
    });

    it("sends the alert to the alert channel", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { alertChannel: "alerts", notificationChannel: "mod-log" });
        await app.fire("PostCreate", postCreateEvent({ post: bigPost(150) }));

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.messages[0]?.channel).toBe("#alerts");
    });

    it("gives the current time as the deletion time when the event has none", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("PostCreate", postCreateEvent({ post: bigPost(150) }));

        await app.fire("PostDelete", userDeletion({ deletedAt: undefined }));

        expect(lastField(app.slack.messages[0])).toStrictEqual({
            title: "⏰ Deleted At",
            value: NOW.toISOString(),
            short: true,
        });
    });

    it("is not alerted below the threshold, and the post stays remembered", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("PostCreate", postCreateEvent({ post: bigPost(99) }));

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.redis.keys()).toStrictEqual([CACHE_KEY]);
    });

    it.each([
        ["a moderator", DeletionSource.MODERATOR],
        ["an admin", DeletionSource.ADMIN],
    ])("is not alerted when %s deletes the post", TEST_OPTIONS, async (_label, source): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("PostCreate", postCreateEvent({ post: bigPost(150) }));

        await app.fire("PostDelete", userDeletion({ source }));

        expect(app.slack.requests).toStrictEqual([]);
    });

    it("is not alerted for a post the app never saw", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.requests).toStrictEqual([]);
    });

    it("is not alerted when the event has no post ID", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("PostDelete", userDeletion({ postId: "" }));

        expect(app.slack.requests).toStrictEqual([]);
        expect(console.error).toHaveBeenCalledWith("PostDelete event missing postId");
    });

    it("is not alerted when deletion alerts are off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { postDeletionUpvoteThreshold: 0 });
        app.context.redis.seed(
            CACHE_KEY,
            JSON.stringify({ score: 5000, title: "T", authorName: "A", permalink: "/p/", subredditName: "s" }),
        );

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.requests).toStrictEqual([]);
    });

    it("is not alerted without a webhook", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: "" });
        await app.fire("PostCreate", postCreateEvent({ post: bigPost(150) }));

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.requests).toStrictEqual([]);
    });

    it(
        "logs a remembered post it cannot read, and the trigger still succeeds",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.redis.seed(CACHE_KEY, "not json");

            await app.fire("PostDelete", userDeletion());

            expect(app.slack.requests).toStrictEqual([]);
            expect(console.error).toHaveBeenCalledWith("Failed to handle post delete:", expect.any(SyntaxError));
        },
    );
});
