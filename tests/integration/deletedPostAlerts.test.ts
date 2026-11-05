import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { bigPost, DeletionReason, DeletionSource, userDeletion } from "../fixtures/events.js";
import type { Settings } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lastField } from "../fixtures/messages.js";
import { keysBesidesBookkeeping } from "../fixtures/redisKeys.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("a user deleting their own post", (): void => {
    it("alerts Slack when the post's score has reached the threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(150)];

        await app.fire("PostDelete", userDeletion());

        expect(app.context.reddit.getPostById).toHaveBeenCalledExactlyOnceWith("t3_big");
        expect(app.slack.messages).toStrictEqual([
            {
                text: "🗑️ User Deleted High-Score Post: 150 upvotes",
                username: "Mod Action Notifications",
                icon_emoji: ":wastebasket:",
                attachments: [
                    {
                        color: "#cc0000",
                        fields: [
                            { title: "📝 Title", value: "Big post", short: false },
                            { title: "👤 Author", value: "/u/Poster", short: true },
                            { title: "⬆️ Score", value: "150", short: true },
                            { title: "🗑️ Reason", value: "Other", short: true },
                            { title: "📍 Subreddit", value: "/r/testsub", short: true },
                            {
                                title: "🔗 Link (may be dead)",
                                value: "https://reddit.com/r/testsub/comments/big/big_post/",
                                short: false,
                            },
                            { title: "⏰ Deleted At", value: "2026-11-04T13:00:00.000Z", short: true },
                        ],
                        footer: "Mod Action Notifications - Post Deletion Monitor",
                        ts: Math.floor(NOW.getTime() / 1000),
                    },
                ],
            },
        ]);
    });

    it("keeps only that the deletion was alerted, for a day", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(150)];

        await app.fire("PostDelete", userDeletion());

        expect(keysBesidesBookkeeping(app.context.redis)).toStrictEqual(["post_deletion:alerted:t3_big"]);
        expect(app.context.redis.ttlSeconds("post_deletion:alerted:t3_big")).toBe(86_400);
    });

    it("is not alerted while the score is below the threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(99)];

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.requests).toStrictEqual([]);
    });

    it(
        "names an unknown author, and the post's own subreddit, when the event names neither",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.reddit.posts = [{ ...bigPost(150), subredditName: "elsewhere" }];

            await app.fire("PostDelete", userDeletion({ author: undefined, subreddit: undefined }));

            const fields = app.slack.messages[0]?.attachments?.[0]?.fields ?? [];

            expect(fields.filter((field): boolean => field.short).map((field): string => field.value)).toStrictEqual([
                "Unknown",
                "150",
                "Other",
                "/r/elsewhere",
                "2026-11-04T13:00:00.000Z",
            ]);
        },
    );

    it("escapes Slack's markup characters in the title", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [{ ...bigPost(150), title: "<!here> big & bold" }];

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.messages[0]?.attachments?.[0]?.fields?.[0]?.value).toBe("&lt;!here&gt; big &amp; bold");
    });

    it.each([
        [DeletionReason.SPAM, "Spam"],
        [DeletionReason.UNSPECIFIED_DELETION_REASON, "Unspecified"],
        [DeletionReason.UNRECOGNIZED, "Unknown"],
    ])("names the deletion reason %s %j", TEST_OPTIONS, async (reason, name): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(150)];

        await app.fire("PostDelete", userDeletion({ reason }));

        const fields = app.slack.messages[0]?.attachments?.[0]?.fields ?? [];

        expect(fields.find((field): boolean => field.title === "🗑️ Reason")?.value).toBe(name);
    });

    it("sends the alert to the alert channel", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { alertChannel: "alerts", notificationChannel: "mod-log" });
        app.context.reddit.posts = [bigPost(150)];

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.messages[0]?.channel).toBe("#alerts");
    });

    // The Alert Channel setting's help text: "uses main channel if empty".
    it(
        "sends the alert to the notification channel when no alert channel is set",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { notificationChannel: "mod-log" });
            app.context.reddit.posts = [bigPost(150)];

            await app.fire("PostDelete", userDeletion());

            expect(app.slack.messages[0]?.channel).toBe("#mod-log");
        },
    );

    it("gives the current time as the deletion time when the event has none", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(150)];

        await app.fire("PostDelete", userDeletion({ deletedAt: undefined }));

        expect(lastField(app.slack.messages[0])).toStrictEqual({
            title: "⏰ Deleted At",
            value: NOW.toISOString(),
            short: true,
        });
    });
});

describe("a deletion that is not alerted", (): void => {
    it.each([
        ["a moderator", DeletionSource.MODERATOR],
        ["an admin", DeletionSource.ADMIN],
    ])("is one by %s, and the post is not looked up", TEST_OPTIONS, async (_label, source): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(150)];

        await app.fire("PostDelete", userDeletion({ source }));

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.reddit.getPostById).not.toHaveBeenCalled();
    });

    it.each([
        ["deletion alerts are off", { postDeletionUpvoteThreshold: 0 }],
        ["no webhook is set", { slackWebhookUrl: "" }],
    ])("is one made while %s", TEST_OPTIONS, async (_label: string, settings: Readonly<Settings>): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, settings);
        app.context.reddit.posts = [bigPost(5000)];

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.reddit.getPostById).not.toHaveBeenCalled();
    });

    it("is one whose event has no post ID, which is logged", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("PostDelete", userDeletion({ postId: "" }));

        expect(app.slack.requests).toStrictEqual([]);
        expect(console.warn).toHaveBeenCalledWith("[postdeletion] A PostDelete event named no post");
    });

    it.each([
        ["Reddit cannot return the post", "t3_big", new Error("post t3_big not found")],
        ["the ID is not a post's", "t1_comment", new Error("t1_comment is not a post ID")],
    ])(
        "is logged when %s, and the trigger still succeeds",
        TEST_OPTIONS,
        async (_label: string, postId: string, error: Readonly<Error>): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire("PostDelete", userDeletion({ postId }));

            expect(app.slack.requests).toStrictEqual([]);
            expect(console.error).toHaveBeenCalledWith("[postdeletion] Could not check a deleted post:", error);
        },
    );
});
