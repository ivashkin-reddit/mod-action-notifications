import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./support/app.js";
import { modActionEvent, removedPost } from "./support/events.js";
import { WEBHOOK_URL } from "./support/fakeContext.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";
import { lines, NOW_SECONDS, onlyMessage, onlyRequest, WHEN_NOW } from "./support/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("a mod action", (): void => {
    it("is posted to the Slack webhook as a formatted message", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost());

        expect(app.slack.requests).toHaveLength(1);

        const request = onlyRequest(app.slack.requests);

        expect(request.url).toBe(WEBHOOK_URL);
        expect(request.method).toBe("POST");
        expect(request.headers).toStrictEqual({ "Content-Type": "application/json" });
        expect(request.message).toStrictEqual({
            text: "🗑️ Post Removed",
            username: "Reddit Mod Bot",
            icon_emoji: ":shield:",
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
                    footer: "Reddit Mod Action Bot",
                    ts: NOW_SECONDS,
                },
            ],
        });
    });

    // Devvit's ModAction event carries the action time in `actionedAt`, which the app does not read.
    it("is timed by when the trigger runs, not by the event’s actionedAt", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ actionedAt: new Date("2026-11-04T11:00:00Z") }));

        const message = onlyMessage(app.slack.messages);

        expect(lines(message)).toContain(WHEN_NOW);
        expect(message.attachments?.[0]?.ts).toBe(NOW_SECONDS);
    });

    it("quotes the post body rather than its title when it has one", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire(
            "ModAction",
            removedPost({ targetPost: { id: "t3_abc", title: "Title", selftext: "Body text" } }),
        );

        expect(lines(onlyMessage(app.slack.messages))).toContain("> Body text");
    });

    it("quotes at most 200 characters of the content", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire(
            "ModAction",
            modActionEvent({
                action: "removecomment",
                moderator: { name: "ModA" },
                targetComment: { id: "t1_c", body: "x".repeat(250), author: "t2_c" },
            }),
        );

        expect(lines(onlyMessage(app.slack.messages))).toContain(`> ${"x".repeat(200)}...`);
    });

    it("quotes content of exactly 200 characters in full", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire(
            "ModAction",
            modActionEvent({
                action: "removecomment",
                moderator: { name: "ModA" },
                targetComment: { id: "t1_c", body: "y".repeat(200), author: "t2_c" },
            }),
        );

        expect(lines(onlyMessage(app.slack.messages))).toContain(`> ${"y".repeat(200)}`);
    });

    it("leaves out the quote and the content link when the content is blank", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire(
            "ModAction",
            modActionEvent({
                action: "removecomment",
                moderator: { name: "ModA" },
                targetComment: { id: "t1_c", body: "   ", author: "Commenter" },
            }),
        );

        expect(lines(onlyMessage(app.slack.messages))).toStrictEqual([
            "🔔 *Moderator Action*",
            "• *Action:* Comment Removed",
            "• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>",
            "• *Target:* <https://www.reddit.com/u/Commenter|u/Commenter>",
            WHEN_NOW,
        ]);
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

    it("names the post author by ID when the event has no target user", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ targetUser: undefined }));

        expect(lines(onlyMessage(app.slack.messages))).toContain(
            "• *Target:* <https://www.reddit.com/u/t2_author|u/t2_author>",
        );
    });

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

    it(
        "goes to the webhook’s default channel when the channel setting is not text",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { notificationChannel: 42 });

            await app.fire("ModAction", removedPost());

            expect(onlyMessage(app.slack.messages)).not.toHaveProperty("channel");
        },
    );
});
