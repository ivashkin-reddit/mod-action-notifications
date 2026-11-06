import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { bigPost, commentDeleteEvent, modActionEvent, removedPost, userDeletion } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { FakeRedis } from "../fixtures/fakeRedis.js";
import { lastField, lines } from "../fixtures/messages.js";
import { queuedQuoting } from "../fixtures/outbox.js";
import { queuedComment, queuedPost } from "../fixtures/queue.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const QUEUE_KEY = "slack_outbox";
/** Slack failing every attempt one drain makes at an alert, so the alert waits in the queue. */
const SLACK_DOWN = [503, 503, 503, 503] as const;

/** ModA removes Commenter's comment t1_c on the post t3_p, whose title is in the comment's link. */
const removedComment = modActionEvent({
    action: "removecomment",
    moderator: { name: "ModA" },
    targetUser: { name: "Commenter" },
    targetComment: {
        id: "t1_c",
        postId: "t3_p",
        author: "Commenter",
        body: "what the comment said",
        permalink: "/r/testsub/comments/p/the_post_title/c/",
    },
});

/** Everything the alert queue stores, as text. */
function queued(redis: Readonly<Pick<FakeRedis, "members">>): string {
    return redis.members(QUEUE_KEY).join("\n");
}

describe("a comment deleted while its removal's alert waits for Slack", (): void => {
    it("leaves neither its text nor its post's title in the queue", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(...SLACK_DOWN);
        await app.fire("ModAction", removedComment);

        await app.fire("CommentDelete", commentDeleteEvent({ commentId: "t1_c", postId: "t3_p" }));

        expect(queued(app.context.redis)).toContain("ModA");
        expect(queued(app.context.redis)).not.toContain("what the comment said");
        expect(queued(app.context.redis)).not.toContain("the_post_title");
    });

    it("is reported without them, with a link that still opens it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(...SLACK_DOWN);
        await app.fire("ModAction", removedComment);
        await app.fire("CommentDelete", commentDeleteEvent({ commentId: "t1_c", postId: "t3_p" }));

        await app.runJob("slackOutbox");

        const [delivered] = app.slack.messages.slice(-1);

        expect(lines(delivered)).toContain(
            "• *Content:* <https://www.reddit.com/r/testsub/comments/p/_/c/|View Comment>",
        );
        expect(JSON.stringify(delivered)).not.toContain("what the comment said");
        expect(JSON.stringify(delivered)).not.toContain("the_post_title");
    });

    it("leaves the queue while no bot token is set", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackBotToken: undefined });
        await app.context.redis.zAdd(QUEUE_KEY, queuedQuoting("t1_c"));

        await app.fire("CommentDelete", commentDeleteEvent({ commentId: "t1_c", postId: "t3_p" }));

        expect(queued(app.context.redis)).not.toContain("said");
    });
});

describe("content deleted before its alert is sent", (): void => {
    it("is never stored, nor sent", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("CommentDelete", commentDeleteEvent({ commentId: "t1_c", postId: "t3_p" }));
        app.slack.respond(...SLACK_DOWN);

        await app.fire("ModAction", removedComment);

        expect(JSON.stringify(app.context.redis.zAdd.mock.calls)).not.toContain("what the comment said");
        expect(JSON.stringify(app.slack.messages)).not.toContain("what the comment said");
        expect(app.slack.messages).toHaveLength(SLACK_DOWN.length);
    });
});

describe("a post deleted while alerts that name it wait for Slack", (): void => {
    it("leaves the removal of the post without its title", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(...SLACK_DOWN);
        await app.fire("ModAction", removedPost());

        await app.fire("PostDelete", userDeletion({ postId: "t3_abc" }));

        expect(queued(app.context.redis)).toContain("Post Removed");
        expect(queued(app.context.redis)).not.toContain("Hello world");
        expect(queued(app.context.redis)).not.toContain("hello_world");
    });

    it("leaves the removal of a comment on it without its title", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(...SLACK_DOWN);
        await app.fire("ModAction", removedComment);

        await app.fire("PostDelete", userDeletion({ postId: "t3_p" }));

        expect(queued(app.context.redis)).not.toContain("the_post_title");
    });
});

describe("content deleted while an age alert listing it waits for Slack", (): void => {
    it.each([
        ["a post it lists", "PostDelete", userDeletion({ postId: "t3_a" })],
        ["a comment it lists", "CommentDelete", commentDeleteEvent({ commentId: "t1_b", postId: "t3_p" })],
        ["the post of a comment it lists", "PostDelete", userDeletion({ postId: "t3_p" })],
    ])(
        "leaves it with no post's title in its links: %s",
        TEST_OPTIONS,
        async (_label: string, trigger: string, deletion: unknown): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 24 });
            app.context.reddit.unmoderated = [
                { ...queuedPost("a", 30), permalink: "/r/testsub/comments/a/a_title/" },
                { ...queuedComment("b", 25), permalink: "/r/testsub/comments/p/p_title/b/" },
            ];
            app.slack.respond(...SLACK_DOWN);
            await app.runJob("modqueueMonitor");

            await app.fire(trigger, deletion);
            await app.runJob("slackOutbox");

            expect(lastField(app.slack.messages.slice(-1)[0])?.value).toBe(
                [
                    "• Post (30h old): https://reddit.com/r/testsub/comments/a/",
                    "• Comment (25h old): https://reddit.com/r/testsub/comments/p/_/b/",
                ].join("\n"),
            );
            expect(queued(app.context.redis)).toBe("");
        },
    );
});

// The alert about a deleted post exists to say what was deleted: the owner's decision, in AGENTS.md.
describe("the alert about a deleted post", (): void => {
    // The deletion takes the post out of other alerts; this one reports it, by its link.
    it("still goes, linking to the post", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(500)];

        await app.fire("PostDelete", userDeletion());

        expect(JSON.stringify(app.slack.messages)).toContain("https://reddit.com/r/testsub/comments/big/");
    });

    it("still goes, logged, when the deletion cannot be noted", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(500)];
        const failure = new Error("redis down");
        app.context.redis.zAdd.mockRejectedValueOnce(failure);

        await app.fire("PostDelete", userDeletion());

        expect(console.error).toHaveBeenCalledWith(
            "[deletions] Could not take a deleted post or comment out of queued alerts:",
            failure,
        );
        expect(JSON.stringify(app.slack.messages)).toContain("https://reddit.com/r/testsub/comments/big/");
    });
});
