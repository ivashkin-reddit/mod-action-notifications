import { describe, expect, it } from "vitest";
import { modAction } from "../../../tests/fixtures/modActions.js";
import { actionTypeOf, isAutoModeratorName, isBlank, isRedditAccount } from "./modAction.js";

const TEST_OPTIONS = { timeout: 1000 };

describe("text that is blank", (): void => {
    it.each([
        [undefined, true],
        ["", true],
        [" ", false],
        ["ModA", false],
    ])("includes %j: %j", TEST_OPTIONS, (value: string | undefined, blank: boolean): void => {
        expect.hasAssertions();

        expect(isBlank(value)).toBe(blank);
    });
});

// Reddit acts in mod logs as u/reddit (Crowd Control, its filters) and Anti-Evil Operations (admin removals).
describe("one of Reddit's own accounts", (): void => {
    it.each([
        ["reddit", true],
        ["Reddit", true],
        ["Anti-Evil Operations", true],
        ["anti-evil operations", true],
        ["redditor", false],
        ["AutoModerator", false],
        [undefined, false],
    ])("is %j: %j", TEST_OPTIONS, (name: string | undefined, isReddit: boolean): void => {
        expect.hasAssertions();

        expect(isRedditAccount(name)).toBe(isReddit);
    });
});

describe("the name AutoModerator", (): void => {
    it.each([
        ["AutoModerator", true],
        ["automoderator", true],
        ["AutoModeratorFan", false],
        [undefined, false],
    ])("is %j: %j", TEST_OPTIONS, (name: string | undefined, isAutoModerator: boolean): void => {
        expect.hasAssertions();

        expect(isAutoModeratorName(name)).toBe(isAutoModerator);
    });
});

describe("an action's type", (): void => {
    it("is Reddit's, or unknown when the event names none", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([actionTypeOf(modAction({ type: "banuser" })), actionTypeOf(modAction({ type: "" }))]).toStrictEqual([
            "banuser",
            "unknown",
        ]);
    });
});
