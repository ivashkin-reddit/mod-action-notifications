import { describe, expect, it } from "vitest";
import { modAction } from "../../../tests/fixtures/modActions.js";
import { activityOf, activitySpike } from "./activity.js";

const TEST_OPTIONS = { timeout: 1000 };

describe("whose activity an action counts toward", (): void => {
    it("is its moderator's, in its subreddit", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(activityOf(modAction())).toStrictEqual({ subredditName: "testsub", moderatorName: "ModA" });
    });

    // Reddit's accounts count, so that a sweep of removals by one is summarised as a moderator's burst is.
    it.each([
        ["u/reddit", "reddit"],
        ["Anti-Evil Operations", "Anti-Evil Operations"],
    ])("is %s's for its action", TEST_OPTIONS, (_label: string, moderatorName: string): void => {
        expect.hasAssertions();

        expect(activityOf(modAction({ moderatorName }))).toStrictEqual({ subredditName: "testsub", moderatorName });
    });

    // AutoModerator's bursts are its rules at work, not a moderator acting fast.
    it.each([
        ["AutoModerator's", { moderatorName: "AutoModerator", isAutoModerator: true }],
        ["one naming no moderator", { moderatorName: undefined }],
        ["one with a blank moderator", { moderatorName: "" }],
        ["one naming no subreddit", { subredditName: undefined }],
    ])("is no one's for %s action", TEST_OPTIONS, (_label: string, fields: Readonly<object>): void => {
        expect.hasAssertions();

        expect(activityOf(modAction(fields))).toBeUndefined();
    });
});

describe("an activity spike", (): void => {
    it.each([
        [1, undefined],
        [4, undefined],
        [5, { count: 5, windowSeconds: 60 }],
        [12, { count: 12, windowSeconds: 60 }],
    ])("from %i actions in a minute is %j", TEST_OPTIONS, (count: number, spike: object | undefined): void => {
        expect.hasAssertions();

        expect(activitySpike(count)).toStrictEqual(spike);
    });
});
