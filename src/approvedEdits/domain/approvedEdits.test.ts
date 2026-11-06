import { describe, expect, it } from "vitest";
import { approvalOf, hoursBetween, isEditAfter, rememberedDays } from "./approvedEdits.js";
import type { Approval, ApprovalAction } from "./approvedEdits.js";

const TEST_OPTIONS = { timeout: 1000 };
const AT = Date.UTC(2026, 10, 4, 12);
const HOUR = 3_600_000;
const DAY = 86_400_000;

function action(fields: Partial<ApprovalAction>): ApprovalAction {
    return {
        type: "approvelink",
        actor: "moderator",
        moderatorName: "ModA",
        itemId: "t3_abc",
        occurredAt: new Date(AT),
        ...fields,
    };
}

describe("an approval", (): void => {
    it("is a moderator's approval of a post or comment, with who and when", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([approvalOf(action({})), approvalOf(action({ type: "approvecomment", itemId: "t1_c" }))]).toStrictEqual([
            { itemId: "t3_abc", approval: { approver: "ModA", at: AT } },
            { itemId: "t1_c", approval: { approver: "ModA", at: AT } },
        ]);
    });

    it(
        "is not any other action, one by AutoModerator or Reddit, or one without an item or moderator",
        TEST_OPTIONS,
        (): void => {
            expect.hasAssertions();

            expect([
                approvalOf(action({ type: "removelink" })),
                approvalOf(action({ actor: "automoderator" })),
                approvalOf(action({ actor: "reddit" })),
                approvalOf(action({ itemId: undefined })),
                approvalOf(action({ itemId: "" })),
                approvalOf(action({ moderatorName: undefined })),
            ]).toStrictEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
        },
    );

    it("is remembered for the configured days, at most 30", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([rememberedDays(7), rememberedDays(30), rememberedDays(400)]).toStrictEqual([7, 30, 30]);
    });
});

describe("an edit after an approval", (): void => {
    const approval: Approval = { approver: "ModA", at: AT };

    it("comes after it, within the configured days", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([
            isEditAfter(approval, AT, 7),
            isEditAfter(approval, AT + 7 * DAY, 7),
            isEditAfter(approval, AT + 7 * DAY + 1, 7),
            isEditAfter(approval, AT - 1, 7),
        ]).toStrictEqual([true, true, false, false]);
    });

    it("is so many whole hours after it", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([hoursBetween(approval, AT + HOUR - 1), hoursBetween(approval, AT + 3 * HOUR + 1)]).toStrictEqual([
            0, 3,
        ]);
    });
});
