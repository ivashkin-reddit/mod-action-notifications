import { describe, expect, it } from "vitest";
import { waitingModmail, withoutPrefix } from "./modmail.js";
import type { OpenConversation } from "./modmail.js";

const TEST_OPTIONS = { timeout: 1000 };
const MS_PER_HOUR = 3_600_000;
const NOW = Date.UTC(2026, 10, 4, 12);

function hoursAgo(hours: number): number {
    return NOW - hours * MS_PER_HOUR;
}

function open(id: string, fields: Partial<OpenConversation>): OpenConversation {
    return {
        id,
        isAppeal: false,
        isAuto: false,
        isArchived: false,
        lastUserUpdate: undefined,
        lastModUpdate: undefined,
        ...fields,
    };
}

describe("modmail waiting for a reply", (): void => {
    it(
        "counts conversations whose user last wrote at least the hours ago, after any moderator, ban appeals apart",
        TEST_OPTIONS,
        (): void => {
            expect.hasAssertions();

            const conversations = [
                open("waited", { lastUserUpdate: hoursAgo(9.5) }),
                open("answered-before", { lastUserUpdate: hoursAgo(7), lastModUpdate: hoursAgo(8) }),
                open("appeal", { isAppeal: true, lastUserUpdate: hoursAgo(6) }),
                open("answered", { lastUserUpdate: hoursAgo(20), lastModUpdate: hoursAgo(20) }),
                open("lately", { lastUserUpdate: hoursAgo(5.9) }),
                open("auto", { isAuto: true, lastUserUpdate: hoursAgo(30) }),
                open("archived", { isArchived: true, lastUserUpdate: hoursAgo(30) }),
                open("no-user", { lastModUpdate: hoursAgo(30) }),
            ];

            expect(waitingModmail({ conversations, complete: true }, 6, NOW)).toStrictEqual({
                waiting: 3,
                appeals: 1,
                longestHours: 9,
                complete: true,
            });
        },
    );

    it("counts a conversation in two folders once, as an appeal if either is", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const conversations = [
            open("c1", { lastUserUpdate: hoursAgo(7) }),
            open("c1", { isAppeal: true, lastUserUpdate: hoursAgo(7) }),
        ];

        expect(waitingModmail({ conversations, complete: false }, 6, NOW)).toStrictEqual({
            waiting: 1,
            appeals: 1,
            longestHours: 7,
            complete: false,
        });
    });

    it("is nothing when nobody has waited long enough", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(
            waitingModmail({ conversations: [open("c1", { lastUserUpdate: hoursAgo(1) })], complete: true }, 6, NOW),
        ).toBeUndefined();
    });
});

describe("a modmail ID from a trigger event", (): void => {
    it("is taken without its prefix, if it has one", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([
            withoutPrefix("ModmailConversation_2abc"),
            withoutPrefix("ModmailMessage_9xyz"),
            withoutPrefix("2abc"),
        ]).toStrictEqual(["2abc", "9xyz", "2abc"]);
    });
});
