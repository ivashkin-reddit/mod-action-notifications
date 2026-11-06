import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { bannedUser } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lines, onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

// The mod log gives a ban its note: the Include Mod Note setting decides whether alerts show it.
describe("a ban's mod note", (): void => {
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

        expect(lines(onlyMessage(app.slack.messages)).slice(-2)).toStrictEqual([
            "• *Details:* 7 days",
            "• *Last 30 days:* nothing in mod notes",
        ]);
    });

    // A mod log entry can give a ban's note without its length; the note is never taken for the length.
    it.each([
        [
            "on",
            true,
            ["• *Ban Duration:* Unknown Duration", "• *Mod Note:* Spamming", "• *Last 30 days:* nothing in mod notes"],
        ],
        ["off", false, ["• *Ban Duration:* Unknown Duration", "• *Last 30 days:* nothing in mod notes"]],
    ])(
        "shows a note the log gives without a length only as the note, with mod notes %s",
        TEST_OPTIONS,
        async (_label: string, includeModNote: boolean, lastLines: readonly string[]): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { includeModNote });
            app.context.reddit.modLog = [
                {
                    id: "ModAction_1",
                    moderatorName: "ModA",
                    createdAt: NOW,
                    description: "Spamming",
                    target: { author: "Troll" },
                },
            ];

            await app.fire("ModAction", bannedUser());

            expect(lines(onlyMessage(app.slack.messages)).slice(5)).toStrictEqual(lastLines);
        },
    );
});
