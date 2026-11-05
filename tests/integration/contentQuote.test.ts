import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { modActionEvent, removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lines, onlyMessage, WHEN_NOW } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("the content a mod action alert quotes", (): void => {
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

    // Slack reads <!channel> as a mention of everyone in the channel, and <url|label> as a link.
    it("quotes content with Slack's markup characters escaped", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire(
            "ModAction",
            modActionEvent({
                action: "removecomment",
                moderator: { name: "ModA" },
                targetComment: { id: "t1_c", body: "<!channel> see <https://x.example|this> & that", author: "t2_c" },
            }),
        );

        expect(lines(onlyMessage(app.slack.messages))).toContain(
            "> &lt;!channel&gt; see &lt;https://x.example|this&gt; &amp; that",
        );
    });

    it(
        "quotes every line of multi-line content, so none reads as part of the alert",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire(
                "ModAction",
                modActionEvent({
                    action: "removecomment",
                    moderator: { name: "ModA" },
                    targetComment: { id: "t1_c", body: "first\n• *Status:* Unknown moderator (alert)", author: "t2_c" },
                }),
            );

            expect(lines(onlyMessage(app.slack.messages)).slice(-3)).toStrictEqual([
                "> first",
                "> • *Status:* Unknown moderator (alert)",
                WHEN_NOW,
            ]);
        },
    );

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
});
