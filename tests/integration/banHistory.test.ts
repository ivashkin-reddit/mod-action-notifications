import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { bannedUser, removedPost } from "../fixtures/events.js";
import type { Settings } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { FakeModNote, Listing } from "../fixtures/fakeReddit.js";
import { lines, onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const DAY = 86_400_000;

/** A note on Troll, made `daysBefore` days before NOW. */
function trollNote(type: string, daysBefore: number): FakeModNote {
    return { user: "Troll", type, createdAt: new Date(NOW.getTime() - daysBefore * DAY) };
}

function historyLine(lineList: readonly string[]): string | undefined {
    return lineList.find((line: string): boolean => line.startsWith("• *Last "));
}

describe("a ban alert", (): void => {
    it(
        "counts the user's mod notes from the 30 days before the ban, by kind, never their text",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.reddit.modNotes = [
                trollNote("REMOVAL", 2),
                trollNote("REMOVAL", 6),
                trollNote("BAN", 10),
                trollNote("APPROVAL", 1),
                trollNote("NOTE", 40),
                trollNote("BAN", 0),
            ];

            await app.fire("ModAction", bannedUser());

            expect(app.context.reddit.getModNotes).toHaveBeenCalledExactlyOnceWith({
                subreddit: "testsub",
                user: "Troll",
                limit: 100,
            });
            expect(historyLine(lines(onlyMessage(app.slack.messages)))).toBe("• *Last 30 days:* 2 removals, 1 ban");
        },
    );

    it("says so when the notes hold nothing in the window", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", bannedUser());

        expect(historyLine(lines(onlyMessage(app.slack.messages)))).toBe("• *Last 30 days:* nothing in mod notes");
    });

    it("leaves the history out, and reads no notes, at 0 days", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { banHistoryDays: 0 });

        await app.fire("ModAction", bannedUser());

        expect(historyLine(lines(onlyMessage(app.slack.messages)))).toBeUndefined();
        expect(app.context.reddit.getModNotes).not.toHaveBeenCalled();
    });

    it("goes without the history, logged, when the notes cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("mod notes unavailable");
        app.context.reddit.getModNotes.mockImplementationOnce((): Listing<FakeModNote> => ({
            all: async (): Promise<readonly FakeModNote[]> => await Promise.reject(failure),
        }));

        await app.fire("ModAction", bannedUser());

        expect(historyLine(lines(onlyMessage(app.slack.messages)))).toBeUndefined();
        expect(console.warn).toHaveBeenCalledWith(
            "[modaction] Could not read the user's mod notes, so alerting the ban without their history:",
            failure,
        );
    });
});

describe("a ban alert whose event names no subreddit", (): void => {
    it(
        "asks Reddit for the subreddit's name once, for the mod log and the notes",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire("ModAction", bannedUser({ subreddit: undefined }));

            expect(app.context.reddit.getCurrentSubredditName).toHaveBeenCalledExactlyOnceWith();
            expect(app.context.reddit.getModNotes).toHaveBeenCalledExactlyOnceWith({
                subreddit: "testsub",
                user: "Troll",
                limit: 100,
            });
        },
    );

    it("goes without the history when Reddit returns no name", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.getCurrentSubredditName.mockResolvedValue("");

        await app.fire("ModAction", bannedUser({ subreddit: undefined }));

        expect(historyLine(lines(onlyMessage(app.slack.messages)))).toBeUndefined();
        expect(app.context.reddit.getModNotes).not.toHaveBeenCalled();
    });
});

describe("mod notes", (): void => {
    it.each([
        ["a ban that is not alerted", { enabledActions: ["unbanuser"] }, bannedUser],
        ["an action other than a ban", {}, removedPost],
    ])(
        "are not read for %s",
        TEST_OPTIONS,
        async (
            _label: string,
            settings: Readonly<Settings>,
            event: () => ReturnType<typeof bannedUser>,
        ): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, settings);

            await app.fire("ModAction", event());

            expect(app.context.reddit.getModNotes).not.toHaveBeenCalled();
        },
    );
});
