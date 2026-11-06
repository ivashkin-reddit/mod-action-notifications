import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import { bannedUser, removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

/** Presses Show Team Stats, and returns the form's title and its lines, as label and value. */
async function teamStats(
    app: Readonly<Pick<App, "pressMenuItem" | "shownForm">>,
): Promise<readonly [string | undefined, readonly (readonly [string, unknown])[]]> {
    await app.pressMenuItem("Show Team Stats");
    const { title, fields } = app.shownForm().definition;

    expect(fields.every((field): boolean => field.disabled === true)).toBe(true);

    return [title, fields.map((field): readonly [string, unknown] => [field.label ?? field.name, field.defaultValue])];
}

describe("the Show Team Stats menu item", (): void => {
    it("shows the team's figures for the last 7 days, naming no moderator", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modLog = [
            {
                id: "ModAction_3",
                moderatorName: "ModA",
                createdAt: NOW,
                details: "7 days",
                target: { author: "Troll" },
            },
        ];
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2", moderator: { name: "AutoModerator" } }));
        await app.fire("ModAction", bannedUser({ id: "ModAction_3" }));

        await expect(teamStats(app)).resolves.toStrictEqual([
            "Team Statistics, last 7 days",
            [
                ["Actions", "3: 2 by moderators, 1 by AutoModerator, 0 by Reddit"],
                ["Most common", "Post Removed 2, User Banned 1"],
                ["Moderators active", "1"],
                ["Hours without a moderator action", "156 of 157; the busiest hour was 12:00 UTC"],
                ["Bans", "1 ban: 1 temporary (averaging 7 days), 0 permanent; 0 unbans"],
                ["Most-moderated threads", "https://www.reddit.com/comments/abc/ (2 removals)"],
                ["Time to act on the queue", "none"],
                ["Reported items", "none"],
                ["Filtered by AutoModerator", "none"],
                ["Removals reversed", "0 of Reddit's, 0 of another moderator's"],
                ["Modmail replies", "none"],
                ["Today", "3 actions"],
            ],
        ]);
    });

    it("says there is nothing yet before any action is counted", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        const [, lines] = await teamStats(app);

        expect(
            lines.filter(([label]): boolean =>
                ["Actions", "Most common", "Most-moderated threads", "Today"].includes(label),
            ),
        ).toStrictEqual([
            ["Actions", "0: 0 by moderators, 0 by AutoModerator, 0 by Reddit"],
            ["Most common", "none"],
            ["Most-moderated threads", "none"],
            ["Today", "0 actions"],
        ]);
    });
});
