import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { modmailReceived } from "../fixtures/contentEvents.js";
import type { Settings } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { FakeConversation } from "../fixtures/fakeModmail.js";
import { lines, onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const ALERT_CHANNEL = "C0ALERTS";
const SETTINGS = { alertChannel: ALERT_CHANNEL };

/** A conversation in which a user wrote first and an admin replied with the message m1. */
function conversationWithAdmin(subject: string): FakeConversation {
    return {
        id: "c1",
        subject,
        folder: "inprogress",
        messages: [
            { id: "m0", author: "SomeUser" },
            { id: "m1", author: "Admin", isAdmin: true },
        ],
    };
}

type QuietCase = Readonly<{
    label: string;
    settings: Readonly<Settings>;
    authorType: string;
    isAdmin: boolean;
}>;

describe("modmail from a Reddit admin", (): void => {
    it(
        "is sent to the alert channel at once, with the subject and a link to the conversation",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, SETTINGS);
            app.context.reddit.conversations = [conversationWithAdmin("About your community's rules")];

            await app.fire("ModMail", modmailReceived());

            const message = onlyMessage(app.slack.messages);

            expect([message.channel, message.text]).toStrictEqual([
                ALERT_CHANNEL,
                "🛡️ Modmail from a Reddit admin: u/Admin",
            ]);
            expect(lines(message)).toStrictEqual([
                "🛡️ *Modmail From a Reddit Admin*",
                "• *From:* u/Admin",
                "• *Subject:* About your community's rules",
                "• *Conversation:* <https://mod.reddit.com/mail/all/c1|Open in Modmail>",
            ]);
            expect(app.context.reddit.modMail.getConversation).toHaveBeenCalledWith({
                conversationId: "c1",
                markRead: false,
            });
        },
    );

    it("escapes the subject, which an admin wrote", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, SETTINGS);
        app.context.reddit.conversations = [conversationWithAdmin("<!channel> read this & act")];

        await app.fire("ModMail", modmailReceived());

        expect(lines(onlyMessage(app.slack.messages))[2]).toBe("• *Subject:* &lt;!channel&gt; read this &amp; act");
    });

    it("is sent once for a message delivered twice", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, SETTINGS);
        app.context.reddit.conversations = [conversationWithAdmin("Hello")];

        await app.fire("ModMail", modmailReceived());
        await app.fire("ModMail", modmailReceived());

        expect(app.slack.messages).toHaveLength(1);
        expect(app.context.redis.ttlSeconds("modmail:admin:m1")).toBe(86_400);
    });

    it("is found whether or not the event's IDs carry their prefixes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, SETTINGS);
        app.context.reddit.conversations = [conversationWithAdmin("Hello")];

        await app.fire("ModMail", modmailReceived({ conversationId: "c1", messageId: "m1" }));

        expect(app.slack.messages).toHaveLength(1);
    });

    it.each<QuietCase>([
        { label: "the author is not an admin", settings: SETTINGS, authorType: "participant_user", isAdmin: false },
        { label: "a moderator writes as one", settings: SETTINGS, authorType: "moderator", isAdmin: true },
        {
            label: "the setting is off",
            settings: { ...SETTINGS, adminModmailAlerts: false },
            authorType: "participant_user",
            isAdmin: true,
        },
    ])(
        "is not alerted when $label",
        TEST_OPTIONS,
        async ({ settings, authorType, isAdmin }: QuietCase): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, settings);
            app.context.reddit.conversations = [
                { id: "c1", subject: "Hello", folder: "new", messages: [{ id: "m1", author: "Admin", isAdmin }] },
            ];

            await app.fire("ModMail", modmailReceived({ authorType }));

            expect(app.slack.requests).toStrictEqual([]);
        },
    );

    it("asks nothing of modmail for a moderator's message", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, SETTINGS);

        await app.fire("ModMail", modmailReceived({ authorType: "moderator" }));

        expect(app.context.reddit.modMail.getConversation).not.toHaveBeenCalled();
    });

    it("sends nothing while Slack is not set up", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...SETTINGS, slackBotToken: undefined });
        app.context.reddit.conversations = [conversationWithAdmin("Hello")];

        await app.fire("ModMail", modmailReceived());

        expect(app.slack.requests).toStrictEqual([]);
    });
});

describe("modmail that cannot be read", (): void => {
    it("is logged once as a problem, and its end when it can be read again", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, SETTINGS);
        app.context.reddit.modMail.getConversation
            .mockRejectedValueOnce(new Error("modmail is down"))
            .mockRejectedValueOnce(new Error("modmail is down"));

        await app.fire("ModMail", modmailReceived());
        await app.fire("ModMail", modmailReceived({ messageId: "ModmailMessage_m2" }));

        expect(vi.mocked(console.error).mock.calls).toStrictEqual([
            [
                "[health] The app cannot read modmail (modmail is down), so modmail from Reddit's admins and modmail waiting for a reply are not alerted.",
            ],
        ]);

        app.context.reddit.conversations = [conversationWithAdmin("Hello")];
        await app.fire("ModMail", modmailReceived({ messageId: "ModmailMessage_m3" }));

        expect(vi.mocked(console.info).mock.calls).toContainEqual(["[health] The app can read modmail again."]);
    });
});
