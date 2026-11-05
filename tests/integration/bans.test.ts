import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { bannedUser } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lastLine, lines, MINUTE, onlyMessage, WHEN_NOW } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("a ban", (): void => {
    // Devvit's ModAction event has no ban duration or reason, so the app looks the ban up in the mod log.
    it("takes its duration and reason from the matching mod log entry", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modLog = [
            {
                id: "ModAction_1",
                moderatorName: "ModA",
                createdAt: NOW,
                details: "7 days",
                description: "Spamming",
                target: { author: "Troll" },
            },
        ];

        await app.fire("ModAction", bannedUser());

        expect(app.context.reddit.getModerationLog).toHaveBeenCalledWith({
            subredditName: "testsub",
            type: "banuser",
            limit: 10,
        });
        expect(lines(onlyMessage(app.slack.messages))).toStrictEqual([
            "🔔 *Moderator Action*",
            "• *Action:* User Banned",
            "• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>",
            "• *Target:* <https://www.reddit.com/u/Troll|u/Troll>",
            WHEN_NOW,
            "• *Ban Duration:* 7 days",
            "• *Details:* 7 days",
            "• *Mod Note:* Spamming",
        ]);
    });

    it.each([
        ["permanent", "Permanent Ban"],
        ["1 day", "1 day"],
        ["30d", "30 days"],
        ["until appeal", "until appeal"],
        // A plural "days" is not parsed as a number (see the legacy-field cases below), so it is shown verbatim.
        ["ban for 7 days", "ban for 7 days"],
    ])("reads the mod log details %j as a duration of %j", TEST_OPTIONS, async (details, duration): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modLog = [
            { id: "ModAction_1", moderatorName: "ModA", createdAt: NOW, details, target: { author: "Troll" } },
        ];

        await app.fire("ModAction", bannedUser());

        expect(lines(onlyMessage(app.slack.messages))).toContain(`• *Ban Duration:* ${duration}`);
    });

    it("leaves out the mod note when mod notes are turned off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { includeModNote: false });
        app.context.reddit.modLog = [
            {
                id: "ModAction_1",
                moderatorName: "ModA",
                createdAt: NOW,
                details: "7 days",
                description: "Spamming",
                target: { author: "Troll" },
            },
        ];

        await app.fire("ModAction", bannedUser());

        expect(lastLine(onlyMessage(app.slack.messages))).toBe("• *Details:* 7 days");
    });

    it("uses the log entry for the same user banned by the same moderator", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modLog = [
            {
                id: "ModAction_2",
                moderatorName: "ModA",
                createdAt: NOW,
                details: "3 days",
                target: { author: "SomeoneElse" },
            },
            {
                id: "ModAction_1",
                moderatorName: "ModA",
                createdAt: NOW,
                details: "7 days",
                target: { author: "troll" },
            },
        ];

        await app.fire("ModAction", bannedUser());

        expect(lines(onlyMessage(app.slack.messages))).toContain("• *Ban Duration:* 7 days");
    });

    it(
        "uses the log entry with the event’s ID even when nothing else about it matches",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.reddit.modLog = [
                {
                    id: "ModAction_1",
                    moderatorName: "ModB",
                    createdAt: new Date(NOW.getTime() - 10 * MINUTE),
                    details: "permanent",
                    target: { author: "Other" },
                },
            ];

            await app.fire("ModAction", bannedUser({ id: "ModAction_1" }));

            expect(lines(onlyMessage(app.slack.messages))).toContain("• *Ban Duration:* Permanent Ban");
        },
    );

    it("uses the moderator’s latest ban when the event names no target", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modLog = [
            {
                id: "ModAction_2",
                moderatorName: "ModB",
                createdAt: new Date(NOW.getTime() - 3 * MINUTE),
                details: "3 days",
                target: { author: "X" },
            },
            { id: "ModAction_1", moderatorName: "MODA", createdAt: NOW, details: "7 days", target: { author: "Y" } },
        ];

        await app.fire("ModAction", bannedUser({ targetUser: undefined }));

        expect(lines(onlyMessage(app.slack.messages))).toContain("• *Ban Duration:* 7 days");
    });

    it(
        "uses any ban from the last two minutes when the event names no target",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.reddit.modLog = [
                {
                    id: "ModAction_2",
                    moderatorName: "ModB",
                    createdAt: new Date(NOW.getTime() - MINUTE),
                    details: "3 days",
                    target: { author: "X" },
                },
            ];

            await app.fire("ModAction", bannedUser({ targetUser: undefined }));

            expect(lines(onlyMessage(app.slack.messages))).toContain("• *Ban Duration:* 3 days");
        },
    );

    it(
        "uses another moderator’s ban of the same user from the last two minutes",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.reddit.modLog = [
                {
                    id: "ModAction_2",
                    moderatorName: "ModB",
                    createdAt: new Date(NOW.getTime() - 3 * MINUTE),
                    details: "3 days",
                    target: { author: "Troll" },
                },
                {
                    id: "ModAction_1",
                    moderatorName: "ModB",
                    createdAt: new Date(NOW.getTime() - 2 * MINUTE),
                    details: "7 days",
                    target: { author: "Troll" },
                },
            ];

            await app.fire("ModAction", bannedUser());

            expect(lines(onlyMessage(app.slack.messages))).toContain("• *Ban Duration:* 7 days");
        },
    );

    it("shows an unknown duration when no log entry matches", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modLog = [
            {
                id: "ModAction_2",
                moderatorName: "ModB",
                createdAt: new Date(NOW.getTime() - 3 * MINUTE),
                details: "3 days",
                target: { author: "Troll" },
            },
        ];

        await app.fire("ModAction", bannedUser());

        const banLines = lines(onlyMessage(app.slack.messages));

        expect(banLines).toContain("• *Ban Duration:* Unknown Duration");
        expect(banLines.some((line): boolean => line.startsWith("• *Details:*"))).toBe(false);
    });

    it("shows an unknown duration when the mod log is empty", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", bannedUser());

        expect(lines(onlyMessage(app.slack.messages))).toContain("• *Ban Duration:* Unknown Duration");
    });

    it("shows an unknown duration when the mod log cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.getModerationLog.mockImplementation((): never => {
            throw new Error("reddit down");
        });

        await app.fire("ModAction", bannedUser());

        expect(lines(onlyMessage(app.slack.messages))).toContain("• *Ban Duration:* Unknown Duration");
    });

    it("asks Reddit for the subreddit name when the event has none", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", bannedUser({ subreddit: undefined }));

        expect(app.context.reddit.getCurrentSubredditName).toHaveBeenCalledExactlyOnceWith();
        expect(app.context.reddit.getModerationLog).toHaveBeenCalledWith({
            subredditName: "testsub",
            type: "banuser",
            limit: 10,
        });
    });

    it("skips the mod log when Reddit returns no subreddit name", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.getCurrentSubredditName.mockResolvedValue("");

        await app.fire("ModAction", bannedUser({ subreddit: undefined }));

        expect(app.context.reddit.getModerationLog).not.toHaveBeenCalled();
    });
});
