import { describe, expect, it } from "vitest";
import { modAction } from "../../../tests/fixtures/modActions.js";
import {
    burstAccountOf,
    burstActorOf,
    burstStep,
    heldAny,
    isOverdue,
    isRemoval,
    NO_REMOVALS,
    removedCount,
    tallyOf,
} from "./burst.js";
import type { Actor } from "./modAction.js";

const TEST_OPTIONS = { timeout: 1000 };
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const OPENED = 1_000_000;
const SPIKE = { count: 5, windowSeconds: 60 };

describe("the removals a burst counts", (): void => {
    it.each([
        ["removelink", true],
        ["removecomment", true],
        ["spamlink", true],
        ["spamcomment", true],
        ["banuser", false],
        ["approvecomment", false],
    ])("include %s: %j", TEST_OPTIONS, (type: string, counted: boolean): void => {
        expect.hasAssertions();

        expect(isRemoval(type)).toBe(counted);
    });
});

describe("the burst a removal joins", (): void => {
    it("is its moderator's, at the spike rate", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(burstAccountOf(modAction({ activitySpike: SPIKE }), "moderator")).toStrictEqual({
            subredditName: "testsub",
            moderatorName: "ModA",
        });
    });

    it("is Anti-Evil Operations', for Reddit's admins at the spike rate", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const sweep = modAction({ moderatorName: "Anti-Evil Operations", activitySpike: SPIKE });

        expect(burstAccountOf(sweep, "reddit")).toStrictEqual({
            subredditName: "testsub",
            moderatorName: "Anti-Evil Operations",
        });
    });

    it.each<readonly [string, Readonly<Parameters<typeof modAction>[0]>, Actor]>([
        ["below the spike", { activitySpike: undefined }, "moderator"],
        ["for an unknown moderator, whose removal is a security alert", { activitySpike: SPIKE }, "unknown-moderator"],
        ["for a ban", { type: "banuser", activitySpike: SPIKE }, "moderator"],
        [
            "for AutoModerator",
            { moderatorName: "AutoModerator", isAutoModerator: true, activitySpike: SPIKE },
            "moderator",
        ],
    ])(
        "is none %s",
        TEST_OPTIONS,
        (_label: string, fields: Readonly<Parameters<typeof modAction>[0]>, actor: Actor): void => {
            expect.hasAssertions();

            expect(burstAccountOf(modAction(fields), actor)).toBeUndefined();
        },
    );

    it("is told as Reddit's for Reddit's accounts, and as a moderator's otherwise", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(burstActorOf({ subredditName: "testsub", moderatorName: "reddit" })).toBe("reddit");
        expect(burstActorOf({ subredditName: "testsub", moderatorName: "ModA" })).toBe("moderator");
    });
});

describe("a scheduled run of a burst", (): void => {
    it("closes it a minute after its latest removal", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const burst = { opened: OPENED, last: OPENED + 10 * SECOND, progressAt: undefined };

        expect(burstStep(burst, OPENED + 70 * SECOND)).toStrictEqual({ kind: "close" });
    });

    it("lets it go on a second short of that, and runs again when the minute is up", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const burst = { opened: OPENED, last: OPENED + 10 * SECOND, progressAt: undefined };

        expect(burstStep(burst, OPENED + 69 * SECOND)).toStrictEqual({
            kind: "continue",
            progress: false,
            nextDue: OPENED + 70 * SECOND,
        });
    });

    it("sends progress five minutes after it opened, then five minutes after that", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const now = OPENED + 5 * MINUTE;
        const later = now + 4 * MINUTE;
        const burst = { opened: OPENED, last: now - SECOND, progressAt: undefined };

        expect(burstStep(burst, now)).toStrictEqual({ kind: "continue", progress: true, nextDue: now + 59 * SECOND });

        expect(burstStep({ ...burst, progressAt: now, last: later - SECOND }, later)).toStrictEqual({
            kind: "continue",
            progress: false,
            nextDue: later + 59 * SECOND,
        });
        expect(burstStep({ ...burst, progressAt: now, last: later + MINUTE - SECOND }, later + MINUTE)).toStrictEqual({
            kind: "continue",
            progress: true,
            nextDue: later + 2 * MINUTE - SECOND,
        });
    });

    it("runs next at the progress summary when that comes before the quiet minute is up", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const progressAt = OPENED + 5 * MINUTE;
        const now = progressAt + 4 * MINUTE + 30 * SECOND;
        const burst = { opened: OPENED, last: now, progressAt };

        expect(burstStep(burst, now)).toStrictEqual({
            kind: "continue",
            progress: false,
            nextDue: progressAt + 5 * MINUTE,
        });
    });
});

describe("a burst's summary", (): void => {
    it("is overdue a minute after it was due", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(isOverdue({ due: OPENED + MINUTE, opened: OPENED }, OPENED + 2 * MINUTE)).toBe(false);
        expect(isOverdue({ due: OPENED + MINUTE, opened: OPENED }, OPENED + 2 * MINUTE + 1)).toBe(true);
    });

    it("is overdue, with none scheduled, two minutes after the burst opened", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(isOverdue({ due: undefined, opened: OPENED }, OPENED + 2 * MINUTE)).toBe(false);
        expect(isOverdue({ due: undefined, opened: OPENED }, OPENED + 2 * MINUTE + 1)).toBe(true);
    });

    it("counts comments, posts, and the spam among them", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const counts = { removecomment: 128, spamcomment: 12, removelink: 2, spamlink: 1 };

        expect(tallyOf(counts)).toStrictEqual({ comments: 140, posts: 3, spam: 13 });
        expect(removedCount(counts)).toBe(143);
    });

    it("has nothing to say when only the removal that opened the burst was counted", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(heldAny({ ...NO_REMOVALS, removecomment: 1 })).toBe(false);
        expect(heldAny({ ...NO_REMOVALS, removecomment: 1, spamlink: 1 })).toBe(true);
    });
});
