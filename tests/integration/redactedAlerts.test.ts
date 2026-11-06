import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import { commentDeleteEvent, modActionEvent, postDeleteEvent } from "../fixtures/events.js";
import { CHANNEL } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { SlackMessage } from "../fixtures/fakeSlack.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const DAY_SECONDS = 86_400;
/** Slack failing every attempt one drain makes at a call, so it waits for a later drain. */
const SLACK_DOWN = [503, 503, 503, 503] as const;
/** The timestamp Slack gives the first message the app posts, at NOW: its seconds, and its place. */
const FIRST_TS = `${String(NOW.getTime() / 1000)}.000001`;

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
const commentDeleted = commentDeleteEvent({ commentId: "t1_c", postId: "t3_p" });

/**
 * The alert for the removal as it is sent once the comment is deleted, made by a second installation of the app:
 * what an edit should turn the alert in Slack into.
 */
async function alertWithoutQuotes(): Promise<SlackMessage> {
    const app = await loadApp(devvit);
    app.slack.respond(...SLACK_DOWN);
    await app.fire("ModAction", removedComment);
    await app.fire("CommentDelete", commentDeleted);
    await app.runJob("slackOutbox");
    const [message] = app.slack.messages.slice(-1);
    if (message === undefined) {
        throw new Error("the alert was not sent");
    }
    return message;
}

/** The alert for the removal in Slack, then the comment deleted, and the drain the deletion scheduled run. */
async function deleteAfterSending(app: Readonly<Pick<App, "fire" | "runJob">>): Promise<void> {
    await app.fire("ModAction", removedComment);
    await app.fire("CommentDelete", commentDeleted);
    await app.runJob("slackOutbox");
}

describe("an alert in Slack quoting a comment then deleted on Reddit", (): void => {
    it("is edited to the alert as it would be sent without the comment", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { text, attachments } = await alertWithoutQuotes();
        const app = await loadApp(devvit);

        await deleteAfterSending(app);

        expect(app.slack.updates).toStrictEqual([{ channel: CHANNEL, ts: FIRST_TS, text, attachments }]);
        expect(JSON.stringify(app.slack.updates)).not.toContain("what the comment said");
        expect(JSON.stringify(app.slack.updates)).not.toContain("the_post_title");
    });

    it("is counted as redacted, and no longer remembered", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await deleteAfterSending(app);

        await expect(app.context.redis.hGetAll("health:count:2026-11-04")).resolves.toMatchObject({
            "alert-redacted": "1",
        });
        expect(app.context.redis.keys()).not.toContain("slack_outbox_sent:t1_c");
        expect(app.context.redis.keys()).not.toContain("slack_outbox_redactions");
    });

    it(
        "is edited when the post the comment is on is deleted, as its link names the post",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            await app.fire("ModAction", removedComment);

            await app.fire("PostDelete", postDeleteEvent({ postId: "t3_p" }));
            await app.runJob("slackOutbox");

            expect(app.slack.updates.map(({ ts }): string => ts)).toStrictEqual([FIRST_TS]);
            expect(JSON.stringify(app.slack.updates)).not.toContain("the_post_title");
        },
    );

    // A workspace can close messages to editing after a time; the app can still delete its own.
    it.each([["edit_window_closed"], ["cant_update_message"]])(
        "is deleted when Slack answers %s to the edit",
        TEST_OPTIONS,
        async (error: string): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(200, error);

            await deleteAfterSending(app);

            expect(app.slack.deletes).toStrictEqual([{ channel: CHANNEL, ts: FIRST_TS }]);
            expect(console.error).not.toHaveBeenCalled();
        },
    );

    it("is left alone when someone has already deleted it in Slack", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(200, "message_not_found");

        await deleteAfterSending(app);

        expect(app.slack.deletes).toStrictEqual([]);
        expect(console.error).not.toHaveBeenCalled();
        expect(app.context.redis.keys()).not.toContain("slack_outbox_redactions");
    });

    it(
        "is reported once, and not sent to modmail, when Slack refuses to edit it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(200, "channel_not_found");

            await deleteAfterSending(app);

            expect(console.error).toHaveBeenCalledExactlyOnceWith(
                "[health] The app could not take a post or comment deleted on Reddit out of an alert in Slack (channel_not_found), so the alert still quotes it. Check that the Slack app is still in the alert channels; an alert it cannot edit can be deleted in Slack.",
            );
            expect(app.context.reddit.modMail.createModNotification).not.toHaveBeenCalled();
            expect(app.context.redis.keys()).not.toContain("slack_outbox_redactions");
        },
    );

    it("waits for Slack to take calls again", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(200, ...SLACK_DOWN);
        await deleteAfterSending(app);

        await app.advance(30_000);
        await app.runJob("slackOutbox");

        expect(app.slack.updates.map(({ ts }): string => ts)).toStrictEqual([
            FIRST_TS,
            FIRST_TS,
            FIRST_TS,
            FIRST_TS,
            FIRST_TS,
        ]);
        expect(app.context.redis.keys()).not.toContain("slack_outbox_redactions");
    });

    it(
        "is not needed when the comment was deleted before the alert reached Slack",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond(...SLACK_DOWN);
            await app.fire("ModAction", removedComment);
            await app.fire("CommentDelete", commentDeleted);

            await app.runJob("slackOutbox");

            expect(app.slack.updates).toStrictEqual([]);
            expect(
                app.context.redis.keys().filter((key: string): boolean => key.startsWith("slack_outbox_sent")),
            ).toStrictEqual([]);
        },
    );

    // The deletion finds nothing remembered yet, so the drain that sent the alert edits it.
    it(
        "is edited when the comment is deleted while the alert is on its way to Slack",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            // The comment is deleted as Slack is called, then Slack answers as it would.
            app.slack.fetch.mockImplementationOnce(
                async (...call: Readonly<Parameters<typeof app.slack.fetch>>): ReturnType<typeof app.slack.fetch> => {
                    await app.fire("CommentDelete", commentDeleted);
                    return await app.slack.fetch(...call);
                },
            );

            await app.fire("ModAction", removedComment);

            expect(app.slack.updates.map(({ ts }): string => ts)).toStrictEqual([FIRST_TS]);
            expect(JSON.stringify(app.slack.updates)).not.toContain("what the comment said");
        },
    );
});

// Stored data: renaming these keys would lose what installations hold.
describe("an alert in Slack quoting Reddit content", (): void => {
    // Kept no longer than Slack keeps the alert itself.
    it("is remembered for as many days as the channels keep messages", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackRetentionDays: 30 });

        await app.fire("ModAction", removedComment);

        expect(app.context.redis.ttlSeconds("slack_outbox_sent:t1_c")).toBe(30 * DAY_SECONDS);
        expect(app.context.redis.ttlSeconds("slack_outbox_sent")).toBe(30 * DAY_SECONDS);
    });

    it(
        "is remembered for 90 days under each post and comment it quotes, with its version without quotes",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { text, attachments, username, icon_emoji: iconEmoji } = await alertWithoutQuotes();
            const app = await loadApp(devvit);
            await app.fire("ModAction", removedComment);

            const remembered = await app.context.redis.hGetAll("slack_outbox_sent:t1_c");

            expect(Object.keys(remembered)).toStrictEqual([`${CHANNEL} ${FIRST_TS}`]);
            expect(JSON.parse(remembered[`${CHANNEL} ${FIRST_TS}`] ?? "")).toStrictEqual({
                text,
                username,
                icon_emoji: iconEmoji,
                channel: CHANNEL,
                attachments,
            });
            await expect(app.context.redis.hGetAll("slack_outbox_sent:t3_p")).resolves.toStrictEqual(remembered);
            expect(app.context.redis.ttlSeconds("slack_outbox_sent:t1_c")).toBe(90 * DAY_SECONDS);
            await expect(app.context.redis.zRange("slack_outbox_sent", 0, -1, { by: "rank" })).resolves.toStrictEqual([
                { member: "t1_c", score: NOW.getTime() },
                { member: "t3_p", score: NOW.getTime() },
            ]);
        },
    );
});
