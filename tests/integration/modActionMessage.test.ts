import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { modActionEvent, removedPost } from "../fixtures/events.js";
import { BOT_TOKEN, CHANNEL } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lines, NOW_SECONDS, onlyMessage, onlyRequest, WHEN_NOW } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("a mod action", (): void => {
    it("is posted to Slack with the bot token, as a formatted message", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost());

        expect(app.slack.requests).toHaveLength(1);

        const request = onlyRequest(app.slack.requests);

        expect(request.url).toBe("https://slack.com/api/chat.postMessage");
        expect(request.method).toBe("POST");
        expect(request.headers).toStrictEqual({
            "content-type": "application/json; charset=utf-8",
            "authorization": `Bearer ${BOT_TOKEN}`,
        });
        expect(request.message).toStrictEqual({
            text: "🗑️ Post Removed",
            username: "Mod Action Notifications",
            icon_emoji: ":shield:",
            channel: CHANNEL,
            attachments: [
                {
                    color: "#ff4444",
                    text: [
                        "🔔 *Moderator Action*",
                        "• *Action:* Post Removed",
                        "• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>",
                        "• *Target:* <https://www.reddit.com/u/Author|u/Author>",
                        "• *Content:* <https://www.reddit.com/r/testsub/comments/abc/hello_world/|View Post>",
                        "> Hello world",
                        WHEN_NOW,
                    ].join("\n"),
                    mrkdwn_in: ["text", "fields"],
                    footer: "Mod Action Notifications",
                    ts: NOW_SECONDS,
                },
            ],
        });
    });

    // Devvit can deliver a trigger some time after the action, so the action is timed by the event's actionedAt.
    it("is timed by the event's actionedAt", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ actionedAt: new Date("2026-11-04T11:00:00Z") }));

        const message = onlyMessage(app.slack.messages);

        expect(lines(message)).toContain("• *When:* 2026-11-04 11:00:00 UTC");
        expect(message.attachments?.[0]?.ts).toBe(NOW_SECONDS - 3600);
    });

    it("is timed by when the trigger runs when the event has no actionedAt", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost());

        expect(lines(onlyMessage(app.slack.messages))).toContain(WHEN_NOW);
    });

    it("keeps an absolute permalink as it is", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire(
            "ModAction",
            removedPost({
                targetPost: { id: "t3_abc", title: "T", permalink: "https://old.reddit.com/r/testsub/comments/abc/" },
            }),
        );

        expect(lines(onlyMessage(app.slack.messages))).toContain(
            "• *Content:* <https://old.reddit.com/r/testsub/comments/abc/|View Post>",
        );
    });

    // The post's authorId is a user ID (t2_...), and a profile link built from one is broken.
    it("leaves out the target when the event names no target user", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ targetUser: undefined }));

        expect(lines(onlyMessage(app.slack.messages)).slice(2, 4)).toStrictEqual([
            "• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>",
            "• *Content:* <https://www.reddit.com/r/testsub/comments/abc/hello_world/|View Post>",
        ]);
    });

    it(
        "describes a comment action by its comment when the event also carries the post",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire(
                "ModAction",
                modActionEvent({
                    action: "removecomment",
                    moderator: { name: "ModA" },
                    targetUser: { name: "Commenter" },
                    targetPost: {
                        id: "t3_abc",
                        title: "The post",
                        selftext: "Post body",
                        permalink: "/r/testsub/comments/abc/x/",
                    },
                    targetComment: {
                        id: "t1_c",
                        body: "The comment",
                        permalink: "/r/testsub/comments/abc/x/c/",
                        author: "t2_c",
                    },
                }),
            );

            expect(lines(onlyMessage(app.slack.messages)).slice(3, 6)).toStrictEqual([
                "• *Target:* <https://www.reddit.com/u/Commenter|u/Commenter>",
                "• *Content:* <https://www.reddit.com/r/testsub/comments/abc/x/c/|View Comment>",
                "> The comment",
            ]);
        },
    );

    it("strips a u/ prefix from usernames and URL-encodes the link", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ targetUser: { name: "U/Zoë" } }));

        expect(lines(onlyMessage(app.slack.messages))).toContain(
            "• *Target:* <https://www.reddit.com/u/Zo%C3%AB|u/Zoë>",
        );
    });

    it(
        "shows the moderator as Unknown when the event names none, without checking the mod list",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire("ModAction", removedPost({ moderator: undefined }));

            expect(lines(onlyMessage(app.slack.messages))[2]).toBe("• *Moderator:* Unknown");
            expect(app.context.reddit.getModerators).not.toHaveBeenCalled();
        },
    );

    it("shows a blank moderator name as Unknown", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { flagUnknownModerators: false });

        await app.fire("ModAction", removedPost({ moderator: { name: "   " } }));

        expect(lines(onlyMessage(app.slack.messages))[2]).toBe("• *Moderator:* Unknown");
    });

    it(
        "is sent to the notification channel, with any leading #s normalised to one",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { notificationChannel: " ###mod-log " });

            await app.fire("ModAction", removedPost());

            expect(onlyMessage(app.slack.messages).channel).toBe("#mod-log");
        },
    );

    it("goes to a channel named by its ID, as it is", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { notificationChannel: " C0456LOGS " });

        await app.fire("ModAction", removedPost());

        expect(onlyMessage(app.slack.messages).channel).toBe("C0456LOGS");
    });

    it(
        "is not sent when the channel setting is not text, as no channel is set",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { notificationChannel: 42 });

            await app.fire("ModAction", removedPost());

            expect(app.slack.requests).toStrictEqual([]);
        },
    );
});
