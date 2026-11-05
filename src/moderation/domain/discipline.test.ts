import { describe, expect, it } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import { modAction } from "../../../tests/fixtures/modActions.js";
import { disciplineEventOf, disciplineStep, disciplineSubject, liftedBy } from "./discipline.js";
import type { DisciplineEvent, DisciplineStep } from "./discipline.js";

const TEST_OPTIONS = { timeout: 1000 };
const HOUR = 3_600_000;
const AT = NOW.getTime();

/** A ban (or its lifting) taken `hoursFromNow` hours from NOW, by `moderatorName`. */
function event(
    change: DisciplineEvent["change"],
    hoursFromNow: number,
    moderatorName = change === "imposed" ? "AliceMod" : "BobMod",
): DisciplineEvent {
    return { change, at: AT + hoursFromNow * HOUR, moderatorName, description: undefined, details: undefined };
}

describe("a discipline step", (): void => {
    it.each<readonly [string, DisciplineStep | undefined]>([
        ["banuser", { kind: "ban", change: "imposed" }],
        ["unbanuser", { kind: "ban", change: "lifted" }],
        ["muteuser", { kind: "mute", change: "imposed" }],
        ["unmuteuser", { kind: "mute", change: "lifted" }],
        ["removelink", undefined],
        ["", undefined],
    ])("is what %j does", TEST_OPTIONS, (type: string, step: DisciplineStep | undefined): void => {
        expect.hasAssertions();

        expect(disciplineStep(type)).toStrictEqual(step);
    });
});

describe("whose discipline an action concerns", (): void => {
    it("is its target's, in its subreddit", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(disciplineSubject("mute", modAction())).toStrictEqual({
            kind: "mute",
            subredditName: "testsub",
            username: "Author",
        });
    });

    it.each([
        ["no subreddit", { subredditName: undefined }],
        ["a blank subreddit", { subredditName: "" }],
        ["no target", { target: undefined }],
        [
            "a target with no name",
            { target: { author: "", permalink: undefined, body: undefined, postId: undefined, commentId: undefined } },
        ],
    ])("is no one's for an action with %s", TEST_OPTIONS, (_label: string, fields: Readonly<object>): void => {
        expect.hasAssertions();

        expect(disciplineSubject("ban", modAction(fields))).toBeUndefined();
    });
});

describe("the event an action records", (): void => {
    it("is when it was taken, by whom, and why", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const ban = modAction({ type: "banuser", description: "Trolling", details: "7 days" });

        expect(disciplineEventOf(ban, "imposed")).toStrictEqual({
            change: "imposed",
            at: AT,
            moderatorName: "ModA",
            description: "Trolling",
            details: "7 days",
        });
    });
});

describe("the ban an unban lifts", (): void => {
    it("is the ban taken before it", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(liftedBy([event("imposed", -2)], AT)).toStrictEqual({
            moderatorName: "AliceMod",
            occurredAt: new Date(AT - 2 * HOUR),
            description: undefined,
            details: undefined,
        });
    });

    it("is the latest of several bans taken before it", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const events = [event("imposed", -5, "First"), event("lifted", -4), event("imposed", -1, "Latest")];

        expect(liftedBy(events, AT)?.moderatorName).toBe("Latest");
    });

    // Events arrive in any order: what counts is when each was taken.
    it("is found however the events are listed", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const events = [event("imposed", -1, "Latest"), event("lifted", -4), event("imposed", -5, "First")];

        expect(liftedBy(events, AT)?.moderatorName).toBe("Latest");
    });

    it("is none when an unban already lifted the last ban", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(liftedBy([event("imposed", -3), event("lifted", -1)], AT)).toBeUndefined();
    });

    // A ban delivered after the unban that lifted it is earlier than that unban, and a later ban is not lifted by it.
    it("leaves out a ban taken after the unban", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(liftedBy([event("imposed", 1)], AT)).toBeUndefined();
    });

    it("includes a ban taken in the same instant as the unban", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(liftedBy([event("imposed", 0)], AT)?.occurredAt).toStrictEqual(NOW);
    });

    // Of a ban and an unban taken in the same instant, the ban came first, so it is already lifted.
    it("is none when a ban and its unban were both taken in that instant", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(liftedBy([event("lifted", 0), event("imposed", 0)], AT)).toBeUndefined();
    });

    it("is none without any events", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(liftedBy([], AT)).toBeUndefined();
    });
});
