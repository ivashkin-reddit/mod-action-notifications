import { describe, expect, it } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import { daysDormant, isEditBy, lineChanges, minuteOf, misfireAfter } from "./watch.js";
import type { WatchedAction } from "./watch.js";

const TEST_OPTIONS = { timeout: 1000 };
const DAY = 86_400_000;
const MINUTE = 60_000;

const WIKI_EDIT: WatchedAction = {
    type: "wikirevise",
    moderatorName: "ModA",
    actor: "moderator",
    occurredAt: NOW,
    subredditName: "testsub",
    targetName: undefined,
};

describe("a moderator's silence", (): void => {
    it("counts in whole days, from the threshold up", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const now = NOW.getTime();

        expect([
            daysDormant(now - 90 * DAY, now, 90),
            daysDormant(now - 90 * DAY + 1, now, 90),
            daysDormant(undefined, now, 90),
            daysDormant(now - 400 * DAY, now, 0),
        ]).toStrictEqual([90, undefined, undefined, undefined]);
    });
});

describe("a config revision", (): void => {
    it("is an action's when its moderator made it, ignoring case, within two minutes", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const revision = { id: "r", date: new Date(NOW.getTime() + 2 * MINUTE), author: "moda", reason: "" };

        expect([
            isEditBy(revision, WIKI_EDIT),
            isEditBy({ ...revision, date: new Date(NOW.getTime() + 2 * MINUTE + 1) }, WIKI_EDIT),
            isEditBy({ ...revision, author: "ModB" }, WIKI_EDIT),
            isEditBy(undefined, WIKI_EDIT),
        ]).toStrictEqual([true, false, false, false]);
    });
});

describe("a config's changes", (): void => {
    it("count lines added and removed, a repeated line each time, leaving out blank lines", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(lineChanges("a\nb\nb\n\n", "a\nb\nc\nc\n")).toStrictEqual({ added: 2, removed: 1 });
    });
});

describe("a misfire", (): void => {
    const editAt = NOW.getTime();
    const editMinute = minuteOf(editAt);

    /** `count` removals in each of `minutes`, as (minute, count). */
    function removals(minutes: readonly number[], count: number): readonly (readonly [number, number])[] {
        return minutes.map((minute: number): readonly [number, number] => [minute, count]);
    }

    it(
        "is 20 or more removals in the hour after, five times the day before's hourly average",
        TEST_OPTIONS,
        (): void => {
            expect.hasAssertions();

            const dayBefore = removals([editMinute - 600, editMinute - 1200], 12);

            expect([
                misfireAfter([...dayBefore, ...removals([editMinute + 5], 20)], editAt, editAt + 10 * MINUTE),
                misfireAfter([...dayBefore, ...removals([editMinute + 5], 19)], editAt, editAt + 10 * MINUTE),
                misfireAfter([...dayBefore, ...removals([editMinute + 5], 20)], editAt, editAt + 61 * MINUTE),
            ]).toStrictEqual([{ sinceEdit: 20, hourlyAverage: 1 }, undefined, undefined]);
        },
    );

    it("needs five times the day before's average", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(
            misfireAfter(
                [...removals([editMinute - 60], 120), ...removals([editMinute + 1], 24)],
                editAt,
                editAt + MINUTE,
            ),
        ).toBeUndefined();
    });
});
