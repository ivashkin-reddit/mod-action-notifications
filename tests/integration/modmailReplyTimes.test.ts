import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { modmailReceived } from "../fixtures/contentEvents.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { MINUTE } from "../fixtures/messages.js";
import { responseLines } from "../fixtures/teamStats.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const HOUR = 60 * MINUTE;

describe("modmail replies", (): void => {
    it("run from a user's message to a moderator's reply", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("ModMail", modmailReceived({ author: "SomeUser", messageId: "ModmailMessage_m1" }));
        await app.advance(MINUTE);
        await app.fire("ModMail", modmailReceived({ author: "SomeUser", messageId: "ModmailMessage_m2" }));
        await app.advance(2 * HOUR);

        await app.fire(
            "ModMail",
            modmailReceived({ author: "ModA", authorType: "moderator", messageId: "ModmailMessage_m3" }),
        );
        await app.fire(
            "ModMail",
            modmailReceived({ author: "ModB", authorType: "moderator", messageId: "ModmailMessage_m4" }),
        );

        await expect(responseLines(app)).resolves.toMatchObject({
            "Modmail replies": "median within 4 hours, of 1 reply",
        });
    });
});

describe("modmail replies in an archived conversation", (): void => {
    it("are not counted, and end the wait that came before", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("ModMail", modmailReceived({ author: "SomeUser", messageId: "ModmailMessage_m1" }));
        await app.advance(2 * HOUR);
        await app.fire(
            "ModMail",
            modmailReceived({
                author: "ModA",
                authorType: "moderator",
                messageId: "ModmailMessage_m2",
                conversationState: "archived",
            }),
        );
        await app.fire(
            "ModMail",
            modmailReceived({ author: "ModA", authorType: "moderator", messageId: "ModmailMessage_m3" }),
        );

        await expect(responseLines(app)).resolves.toMatchObject({ "Modmail replies": "none" });
    });

    it("start no wait when a user writes in one", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire(
            "ModMail",
            modmailReceived({ author: "SomeUser", messageId: "ModmailMessage_m1", conversationState: "archived" }),
        );
        await app.advance(HOUR);
        await app.fire(
            "ModMail",
            modmailReceived({ author: "ModA", authorType: "moderator", messageId: "ModmailMessage_m2" }),
        );

        await expect(responseLines(app)).resolves.toMatchObject({ "Modmail replies": "none" });
    });
});
