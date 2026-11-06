import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { commentEdited, postEdited } from "../fixtures/contentEvents.js";
import { modActionEvent } from "../fixtures/events.js";
import type { Settings } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lines, onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const ALERT_CHANNEL = "C0ALERTS";
const SETTINGS = { alertChannel: ALERT_CHANNEL };
const HOUR = 3_600_000;

/** `moderator` approves Author's post t3_abc. */
function approvedPost(moderator = "ModA"): ReturnType<typeof modActionEvent> {
    return modActionEvent({
        id: `approve-${moderator}`,
        action: "approvelink",
        moderator: { name: moderator },
        targetUser: { name: "Author" },
        targetPost: {
            id: "t3_abc",
            title: "Hello world",
            permalink: "/r/testsub/comments/abc/hello_world/",
            authorId: "t2_author",
        },
    });
}

/** ModB approves Commenter's comment t1_c. */
function approvedComment(): ReturnType<typeof modActionEvent> {
    return modActionEvent({
        id: "approve-comment",
        action: "approvecomment",
        moderator: { name: "ModB" },
        targetUser: { name: "Commenter" },
        targetComment: {
            id: "t1_c",
            postId: "t3_abc",
            body: "what it said",
            permalink: "/r/testsub/comments/abc/hello_world/c/",
            author: "Commenter",
        },
    });
}

type QuietCase = Readonly<{ label: string; settings: Readonly<Settings>; approver: string; previousBody: string }>;

describe("an edit after a moderator approved the post or comment", (): void => {
    it(
        "is sent to the alert channel: who edited, who approved and how long before, with a link",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, SETTINGS);
            await app.fire("ModAction", approvedPost());
            await app.advance(3 * HOUR);

            await app.fire("PostUpdate", postEdited());

            const message = onlyMessage(app.slack.messages);

            expect([message.channel, message.text]).toStrictEqual([
                ALERT_CHANNEL,
                "✏️ Edited after approval: u/Author's post",
            ]);
            expect(lines(message)).toStrictEqual([
                "✏️ *Edited After Approval*",
                "• *Author:* u/Author",
                "• *Approved by:* u/ModA, 3 hours before the edit",
                "• *Content:* <https://www.reddit.com/r/testsub/comments/abc/|View Post>",
            ]);
        },
    );

    it("quotes neither version of the text, nor the post's title", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, SETTINGS);
        await app.fire("ModAction", approvedComment());

        await app.fire("CommentUpdate", commentEdited());

        expect(lines(onlyMessage(app.slack.messages)).slice(1)).toStrictEqual([
            "• *Author:* u/Commenter",
            "• *Approved by:* u/ModB, less than an hour before the edit",
            "• *Content:* <https://www.reddit.com/r/testsub/comments/abc/_/c/|View Comment>",
        ]);
        expect(JSON.stringify(app.slack.requests)).not.toMatch(/Hello world|hello_world|what it said|what it says/u);
    });

    it("is sent once a day for each post or comment", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, SETTINGS);
        await app.fire("ModAction", approvedPost());

        await app.fire("PostUpdate", postEdited());
        await app.fire("PostUpdate", postEdited({ previousBody: "what it says now", body: "and again" }));

        expect(app.slack.messages).toHaveLength(1);
        expect(app.context.redis.ttlSeconds("approved_edits:alerted:t3_abc")).toBe(86_400);
    });

    it("remembers an approval, as metadata, for the configured days", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...SETTINGS, editsAfterApprovalDays: 3 });

        await app.fire("ModAction", approvedPost());

        expect(app.context.redis.dump("approved_edits:approved:t3_abc")).toStrictEqual({
            kind: "string",
            text: JSON.stringify({ approver: "ModA", at: Date.now() }),
        });
        expect(app.context.redis.ttlSeconds("approved_edits:approved:t3_abc")).toBe(3 * 86_400);
    });

    it.each<QuietCase>([
        {
            label: "the update leaves the text as it was",
            settings: SETTINGS,
            approver: "ModA",
            previousBody: "what it says now",
        },
        { label: "AutoModerator approved it", settings: SETTINGS, approver: "AutoModerator", previousBody: "before" },
        {
            label: "the setting is 0",
            settings: { ...SETTINGS, editsAfterApprovalDays: 0 },
            approver: "ModA",
            previousBody: "before",
        },
    ])(
        "is not alerted when $label",
        TEST_OPTIONS,
        async ({ settings, approver, previousBody }: QuietCase): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, settings);
            await app.fire("ModAction", approvedPost(approver));

            await app.fire("PostUpdate", postEdited({ previousBody }));

            expect(app.slack.requests).toStrictEqual([]);
        },
    );

    it("is not alerted for a post no moderator approved", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, SETTINGS);

        await app.fire("PostUpdate", postEdited());

        expect(app.slack.requests).toStrictEqual([]);
    });

    it("keeps no approval while the setting is 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...SETTINGS, editsAfterApprovalDays: 0 });

        await app.fire("ModAction", approvedPost());

        expect(app.context.redis.dump("approved_edits:approved:t3_abc")).toBeUndefined();
    });

    it("sends nothing while Slack is not set up", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...SETTINGS, slackBotToken: undefined });
        await app.fire("ModAction", approvedPost());

        await app.fire("PostUpdate", postEdited());

        expect(app.slack.requests).toStrictEqual([]);
    });
});
