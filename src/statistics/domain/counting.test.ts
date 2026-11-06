import { describe, expect, it } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import { dayOf, moderatorHash, tallyOf } from "./counting.js";
import type { CountedAction } from "./counting.js";

const TEST_OPTIONS = { timeout: 1000 };

/** An action's type and ban length, and what it adds to the day's ban counts. */
type BanCase = Readonly<{
    label: string;
    type: string;
    banDays: number | undefined;
    banCounts: Readonly<Record<string, number>>;
}>;

function action(fields: Readonly<Partial<CountedAction>> = {}): CountedAction {
    return {
        id: "ModAction_1",
        type: "removelink",
        actor: "moderators",
        moderatorName: "ModA",
        occurredAt: NOW,
        postId: "t3_abc",
        banDays: undefined,
        itemId: undefined,
        ...fields,
    };
}

describe("a moderator's hash", (): void => {
    it("is eight hex digits, the same for a name in any case", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(moderatorHash("ModA")).toMatch(/^[\da-f]{8}$/u);
        expect(moderatorHash("MODA")).toBe(moderatorHash("moda"));
        expect(moderatorHash("ModA")).not.toBe(moderatorHash("ModB"));
    });
});

describe("an action's tally", (): void => {
    it("is for its UTC day, by who took it and its type", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(tallyOf(action({ occurredAt: new Date("2026-11-04T23:59:59Z") }))).toMatchObject({
            day: "2026-11-04",
            actionField: "moderators:removelink",
            hour: 23,
            removedFrom: "t3_abc",
        });
        expect(dayOf(new Date("2026-11-05T00:00:00Z"))).toBe("2026-11-05");
    });

    it("counts no hour or moderator for AutoModerator's and Reddit's actions", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(
            [tallyOf(action({ actor: "automoderator" })), tallyOf(action({ actor: "reddit" }))].map(
                ({ hour, moderatorHash: hash }): readonly unknown[] => [hour, hash],
            ),
        ).toStrictEqual([
            [undefined, undefined],
            [undefined, undefined],
        ]);
    });

    it.each<BanCase>([
        { label: "a temporary ban", type: "banuser", banDays: 7, banCounts: { bans: 1, temporary: 1, banDays: 7 } },
        { label: "a permanent ban", type: "banuser", banDays: 0, banCounts: { bans: 1, permanent: 1 } },
        { label: "a ban of unknown length", type: "banuser", banDays: undefined, banCounts: { bans: 1 } },
        { label: "an unban", type: "unbanuser", banDays: undefined, banCounts: { unbans: 1 } },
        { label: "a removal", type: "removelink", banDays: undefined, banCounts: {} },
    ])("counts $label", TEST_OPTIONS, ({ type, banDays, banCounts }: BanCase): void => {
        expect.hasAssertions();

        expect(tallyOf(action({ type, banDays })).banCounts).toStrictEqual(banCounts);
    });

    it("names a type the event left out unknown, and counts no thread for other actions", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(tallyOf(action({ type: "" }))).toMatchObject({
            actionField: "moderators:unknown",
            removedFrom: undefined,
        });
    });
});
