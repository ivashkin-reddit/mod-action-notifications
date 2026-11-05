import { describe, expect, it } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import { modAction } from "../../../tests/fixtures/modActions.js";
import {
    banDurationText,
    banLengthLabel,
    daysLabel,
    hasBanDurationMetadata,
    matchBanLogEntry,
    parseBanDuration,
    withBanLogEntry,
} from "./banDuration.js";
import type { BanDuration, BanLogEntry } from "./banDuration.js";

const TEST_OPTIONS = { timeout: 1000 };
const MINUTE = 60_000;

/** AliceMod's ban of Troll, in the mod log at NOW. */
function logged(fields: Readonly<Partial<BanLogEntry>> = {}): BanLogEntry {
    return {
        id: "ModAction_ban",
        moderatorName: "AliceMod",
        createdAt: NOW,
        details: "7 days",
        description: "Trolling",
        targetAuthor: "Troll",
        ...fields,
    };
}

/** AliceMod banning Troll at NOW, as the trigger delivers it: no length, details or note. */
const BAN = modAction({
    id: "ModAction_ban",
    type: "banuser",
    moderatorName: "AliceMod",
    target: { author: "Troll", permalink: undefined, body: undefined, postId: undefined, commentId: undefined },
});

describe("a ban length", (): void => {
    it.each([
        [1, "1 day"],
        [2, "2 days"],
        [30, "30 days"],
    ])("reads %i days as %j", TEST_OPTIONS, (days: number, label: string): void => {
        expect.hasAssertions();

        expect(daysLabel(days)).toBe(label);
    });

    it("reads 0 days as a permanent ban", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([banLengthLabel(0), banLengthLabel(7)]).toStrictEqual(["Permanent Ban", "7 days"]);
    });
});

describe("parsing a ban length from text", (): void => {
    it.each<readonly [string, string | undefined, BanDuration]>([
        ["no text", undefined, { days: undefined, label: undefined }],
        ["blank text", "   ", { days: undefined, label: undefined }],
        ["permanent, in any case", "PERMANENT ban for spam", { days: 0, label: "Permanent Ban" }],
        ["a number of days", "7 day ban", { days: 7, label: "7 days" }],
        ["one day", "1 day", { days: 1, label: "1 day" }],
        ["a number with d", "ban 30d for spam", { days: 30, label: "30 days" }],
        ["a number with no space before day", "a 3day ban", { days: 3, label: "3 days" }],
        // Pinned: a plural "days" is not read as a number, so the text is shown as written.
        ["a plural days", "7 days", { days: undefined, label: "7 days" }],
        ["text with no length", "until appeal", { days: undefined, label: "until appeal" }],
    ])("reads %s", TEST_OPTIONS, (_label: string, text: string | undefined, expected: BanDuration): void => {
        expect.hasAssertions();

        expect(parseBanDuration(text)).toStrictEqual(expected);
    });
});

describe("whether a ban says how long it is", (): void => {
    it.each([
        ["a length in days, permanent included", { banDuration: 0 }, true],
        ["a length label", { banDurationLabel: "until appeal" }, true],
        ["details", { details: "7 days" }, true],
        ["only blank text", { banDurationLabel: "  ", details: " " }, false],
        ["nothing", {}, false],
    ])(
        "is answered by %s",
        TEST_OPTIONS,
        (_label: string, fields: Readonly<Partial<typeof BAN>>, says: boolean): void => {
            expect.hasAssertions();

            expect(hasBanDurationMetadata({ ...BAN, ...fields })).toBe(says);
        },
    );
});

describe("how a ban's length reads in an alert", (): void => {
    it.each([
        ["its length in days first", { banDuration: 7, banDurationLabel: "a week", details: "x" }, "7 days"],
        ["a permanent ban", { banDuration: 0 }, "Permanent Ban"],
        ["its label, without a length", { banDurationLabel: "until appeal", details: "x" }, "until appeal"],
        ["its details, trimmed, without a label", { details: " 3 days " }, "3 days"],
        ["a length in its note, without details", { description: "7 day ban" }, "7 days"],
        ["nothing known", {}, "Unknown Duration"],
    ])("gives %s", TEST_OPTIONS, (_label: string, fields: Readonly<Partial<typeof BAN>>, text: string): void => {
        expect.hasAssertions();

        expect(banDurationText({ ...BAN, ...fields })).toBe(text);
    });
});

describe("finding a ban in the mod log", (): void => {
    // The mod log lists the newest first. Devvit can deliver a ban late, after a newer ban of the same user by the
    // same moderator: the entry with the ban's own ID is the one that describes it.
    it("prefers the entry with the ban's ID to a newer one for the same user", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const newer = logged({
            id: "ModAction_newer",
            createdAt: new Date(NOW.getTime() + 5 * MINUTE),
            details: "30 days",
        });
        const own = logged();

        expect(matchBanLogEntry([newer, own], BAN)).toBe(own);
    });

    it("takes the entry with the ban's ID, whoever and whenever it names", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const own = logged({ moderatorName: "BobMod", targetAuthor: "Someone", createdAt: new Date(0) });

        expect(matchBanLogEntry([logged({ id: "other", targetAuthor: "Someone" }), own], BAN)).toBe(own);
    });

    it("takes an entry for the same user by the same moderator", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const entry = logged({ id: "other", createdAt: new Date(NOW.getTime() - 10 * MINUTE) });

        expect(matchBanLogEntry([logged({ id: "x", targetAuthor: "Someone" }), entry], { ...BAN, id: undefined })).toBe(
            entry,
        );
    });

    it("takes an entry for the same user by anyone, when the ban names no moderator", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const entry = logged({
            id: "other",
            moderatorName: "BobMod",
            createdAt: new Date(NOW.getTime() - 10 * MINUTE),
        });

        expect(matchBanLogEntry([entry], { ...BAN, id: undefined, moderatorName: undefined })).toBe(entry);
    });

    it("takes an entry by the same moderator, when the ban names no user", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const entry = logged({
            id: "other",
            targetAuthor: "Someone",
            createdAt: new Date(NOW.getTime() - 10 * MINUTE),
        });

        expect(matchBanLogEntry([entry], { ...BAN, id: undefined, target: undefined })).toBe(entry);
    });

    it("takes an entry for the same user within two minutes, by another moderator", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const entry = logged({ id: "other", moderatorName: "BobMod", createdAt: new Date(NOW.getTime() + 2 * MINUTE) });

        expect(matchBanLogEntry([entry], { ...BAN, id: undefined })).toBe(entry);
    });

    it("finds none for the same user by another moderator, more than two minutes away", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const entry = logged({
            id: "other",
            moderatorName: "BobMod",
            createdAt: new Date(NOW.getTime() + 2 * MINUTE + 1),
        });

        expect(matchBanLogEntry([entry], { ...BAN, id: undefined })).toBeUndefined();
    });

    it("finds none by the same moderator for another user, more than two minutes away", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const entry = logged({
            id: "other",
            targetAuthor: "Someone",
            createdAt: new Date(NOW.getTime() - 10 * MINUTE),
        });

        expect(matchBanLogEntry([entry], { ...BAN, id: undefined })).toBeUndefined();
    });

    it("finds none in an empty mod log", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(matchBanLogEntry([], BAN)).toBeUndefined();
    });
});

describe("completing a ban from its mod log entry", (): void => {
    it("takes the entry's length, details and note", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(withBanLogEntry(BAN, logged({ details: "7 day", description: "Trolling" }))).toMatchObject({
            banDuration: 7,
            banDurationLabel: "7 days",
            details: "7 day",
            description: "Trolling",
        });
    });

    it("keeps the details and note the ban already had", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const ban = { ...BAN, details: "Given in chat", description: "Spam" };

        expect(withBanLogEntry(ban, logged())).toMatchObject({ details: "Given in chat", description: "Spam" });
    });

    it("reads a length from the note when the entry has no details", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(withBanLogEntry(BAN, logged({ details: undefined, description: "permanent" }))).toMatchObject({
            banDuration: 0,
            banDurationLabel: "Permanent Ban",
        });
    });

    it("keeps the ban's own label when the entry gives no length", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const ban = { ...BAN, banDurationLabel: "until appeal" };

        expect(withBanLogEntry(ban, logged({ details: "", description: "" })).banDurationLabel).toBe("until appeal");
    });
});
