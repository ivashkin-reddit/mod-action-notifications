import { describe, expect, it } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import { recentHistory } from "./history.js";
import type { NoteEntry, NoteKind } from "./history.js";

const TEST_OPTIONS = { timeout: 1000 };
const DAY = 86_400_000;

function note(kind: NoteKind, daysBefore: number): NoteEntry {
    return { kind, createdAt: new Date(NOW.getTime() - daysBefore * DAY) };
}

describe("a user's recent history", (): void => {
    it("counts their notes in the days before the action, by kind", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const notes = [note("removal", 2), note("removal", 5), note("ban", 10), note("note", 29)];

        expect(recentHistory(notes, NOW, 30)).toStrictEqual({
            days: 30,
            counts: { removal: 2, spam: 0, ban: 1, mute: 0, note: 1 },
        });
    });

    // Reddit notes a ban as it is made, to the second: that note is the action's own.
    it("leaves out notes older than the window, and the action's own", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const notes: readonly NoteEntry[] = [
            note("removal", 31),
            note("ban", 0),
            { kind: "ban", createdAt: new Date(NOW.getTime() + 400) },
        ];

        expect(recentHistory(notes, NOW, 30).counts).toStrictEqual({ removal: 0, spam: 0, ban: 0, mute: 0, note: 0 });
    });

    it("leaves out kinds it does not count", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(recentHistory([note("other", 1)], NOW, 30).counts).toStrictEqual({
            removal: 0,
            spam: 0,
            ban: 0,
            mute: 0,
            note: 0,
        });
    });
});
