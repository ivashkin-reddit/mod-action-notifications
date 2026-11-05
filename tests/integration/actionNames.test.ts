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

/** How a message names an action: its title, its plain name on the Action line, and its attachment colour. */
type ActionName = Readonly<{ action: string; title: string; plain: string; color: string }>;

describe("naming a mod action", (): void => {
    it("names a comment action and links to the comment", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire(
            "ModAction",
            modActionEvent({
                action: "removecomment",
                moderator: { name: "ModA" },
                targetUser: { name: "Commenter" },
                targetComment: {
                    id: "t1_c",
                    body: "Rude comment",
                    permalink: "/r/testsub/comments/abc/x/c/",
                    author: "t2_c",
                },
            }),
        );

        const message = onlyMessage(app.slack.messages);

        expect(message.text).toBe("🗑️ Comment Removed");
        expect(lines(message)).toStrictEqual([
            "🔔 *Moderator Action*",
            "• *Action:* Comment Removed",
            "• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>",
            "• *Target:* <https://www.reddit.com/u/Commenter|u/Commenter>",
            "• *Content:* <https://www.reddit.com/r/testsub/comments/abc/x/c/|View Comment>",
            "> Rude comment",
            WHEN_NOW,
        ]);
    });

    it.each([
        ["lock", "🔒 Comment Locked", "Comment Locked"],
        ["unlock", "🔓 Comment Unlocked", "Comment Unlocked"],
    ])("names %s on a comment as a comment action", TEST_OPTIONS, async (action, title, plain): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: [action] });

        await app.fire(
            "ModAction",
            modActionEvent({
                action,
                moderator: { name: "ModA" },
                targetComment: { id: "t1_c", body: "text", author: "t2_c" },
            }),
        );

        const message = onlyMessage(app.slack.messages);

        expect(message.text).toBe(title);
        expect(lines(message)[1]).toBe(`• *Action:* ${plain}`);
    });

    it.each([
        { action: "removelink", title: "🗑️ Post Removed", plain: "Post Removed", color: "#ff4444" },
        { action: "removecomment", title: "🗑️ Comment Removed", plain: "Comment Removed", color: "#ff4444" },
        { action: "spamlink", title: "🚫 Post Marked as Spam", plain: "Post Marked as Spam", color: "#ff0088" },
        {
            action: "spamcomment",
            title: "🚫 Comment Marked as Spam",
            plain: "Comment Marked as Spam",
            color: "#ff0088",
        },
        { action: "banuser", title: "🔨 User Banned", plain: "User Banned", color: "#cc0000" },
        { action: "unbanuser", title: "🎉 User Unbanned", plain: "User Unbanned", color: "#00cc00" },
        { action: "lock", title: "🔒 Post Locked", plain: "Post Locked", color: "#ff8800" },
        { action: "unlock", title: "🔓 Post Unlocked", plain: "Post Unlocked", color: "#00cc00" },
        { action: "sticky", title: "📌 Post Stickied", plain: "Post Stickied", color: "#0088ff" },
        { action: "unsticky", title: "📌 Post Unstickied", plain: "Post Unstickied", color: "#888888" },
        { action: "approvelink", title: "✅ Post Approved", plain: "Post Approved", color: "#00cc00" },
        { action: "approvecomment", title: "✅ Comment Approved", plain: "Comment Approved", color: "#00cc00" },
        { action: "editflair", title: "🏷️ Flair Edited", plain: "Flair Edited", color: "#8800ff" },
        { action: "muteuser", title: "🔇 User Muted", plain: "User Muted", color: "#ff8800" },
        { action: "unmuteuser", title: "🔊 User Unmuted", plain: "User Unmuted", color: "#00cc00" },
        { action: "distinguish", title: "⭐ Distinguished", plain: "Distinguished", color: "#0088ff" },
        { action: "ignorereports", title: "🔕 Reports Ignored", plain: "Reports Ignored", color: "#888888" },
        { action: "unignorereports", title: "🔔 Reports Unignored", plain: "Reports Unignored", color: "#00cc00" },
        { action: "snoozereports", title: "⏰ Reports Snoozed", plain: "Reports Snoozed", color: "#ff8800" },
        { action: "unsnoozereports", title: "⏰ Reports Unsnoozed", plain: "Reports Unsnoozed", color: "#00cc00" },
        { action: "addcontributor", title: "✅ Approved User Added", plain: "Approved User Added", color: "#00cc00" },
        {
            action: "removecontributor",
            title: "❌ Approved User Removed",
            plain: "Approved User Removed",
            color: "#ff4444",
        },
        { action: "invitemoderator", title: "📨 Moderator Invited", plain: "Moderator Invited", color: "#0088ff" },
        {
            action: "uninvitemoderator",
            title: "📭 Moderator Uninvited",
            plain: "Moderator Uninvited",
            color: "#ff8800",
        },
        {
            action: "acceptmoderatorinvite",
            title: "✅ Moderator Invite Accepted",
            plain: "Moderator Invite Accepted",
            color: "#00cc00",
        },
        { action: "addmoderator", title: "👤 Moderator Added", plain: "Moderator Added", color: "#0088ff" },
        { action: "removemoderator", title: "👤 Moderator Removed", plain: "Moderator Removed", color: "#ff4444" },
        { action: "editsettings", title: "⚙️ Settings Edited", plain: "Settings Edited", color: "#8800ff" },
        {
            action: "adjust_post_crowd_control_level",
            title: "👥 Crowd Control Adjusted",
            plain: "Crowd Control Adjusted",
            color: "#ff8800",
        },
        {
            action: "enable_post_crowd_control_filter",
            title: "🛡️ Crowd Control Enabled",
            plain: "Crowd Control Enabled",
            color: "#ff8800",
        },
        {
            action: "disable_post_crowd_control_filter",
            title: "🛡️ Crowd Control Disabled",
            plain: "Crowd Control Disabled",
            color: "#00cc00",
        },
        { action: "wikirevise", title: "wikirevise", plain: "wikirevise", color: "#666666" },
    ])(
        'names $action "$title" and colours it $color',
        TEST_OPTIONS,
        async ({ action, title, plain, color }: ActionName): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { enabledActions: [action] });

            await app.fire("ModAction", removedPost({ action }));

            const message = onlyMessage(app.slack.messages);

            expect(message.text).toBe(title);
            expect(message.attachments?.[0]?.color).toBe(color);
            expect(lines(message)[1]).toBe(`• *Action:* ${plain}`);
        },
    );
});
