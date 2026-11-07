import { describe, expect, it, vi } from "vitest";
import { workingPorts } from "../../../tests/fixtures/moderationPorts.js";
import type { ModeratorRef } from "../domain/activity.js";
import type { RemovalType } from "../domain/burst.js";
import { joinBurst, summariseBurst } from "./bursts.js";

const TEST_OPTIONS = { timeout: 1000 };
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const OPENED = 1_000_000;
const MOD_A = { subredditName: "testsub", moderatorName: "ModA" };
const FAILURE = new Error("scheduler down");

/** Working ports, and ways to drive them: removals, and the scheduler running the summaries as they fall due. */
type Scenario = Readonly<{
    ports: ReturnType<typeof workingPorts>;
    /** The account's removals of `type`, at each of `times` (ms after OPENED); the summaries due before each run first. */
    removals: (times: readonly number[], type?: RemovalType, account?: ModeratorRef) => Promise<void>;
    /** Runs a summary of the account's burst due at `due`, at `now`. */
    run: (due: number, now: number, account?: ModeratorRef) => Promise<void>;
    /** Runs every summary left to run, each when it is due. */
    runSchedule: () => Promise<void>;
}>;

function scenario(): Scenario {
    const ports = workingPorts();
    const run = async (due: number, now: number, account: ModeratorRef = MOD_A): Promise<void> => {
        await summariseBurst({ account, due, now }, ports);
    };
    const runDue = async (until: number): Promise<void> => {
        const [next] = [...ports.scheduled].sort((first, second): number => first.due - second.due);
        if (next === undefined || next.due > until) {
            return;
        }
        ports.scheduled.splice(ports.scheduled.indexOf(next), 1);
        await run(next.due, next.due, next.account);
        await runDue(until);
    };
    return {
        ports,
        run,
        removals: async (
            times: readonly number[],
            type: RemovalType = "removecomment",
            account: ModeratorRef = MOD_A,
        ): Promise<void> => {
            for (const time of times) {
                await runDue(OPENED + time);
                await joinBurst({ account, type, at: OPENED + time }, ports);
            }
        },
        runSchedule: async (): Promise<void> => {
            await runDue(Number.POSITIVE_INFINITY);
        },
    };
}

/** Times every `gap` ms from 0, `count` of them. */
function every(gap: number, count: number): readonly number[] {
    return Array.from({ length: count }, (_unused: unknown, index: number): number => index * gap);
}

describe("a burst's scheduled run", (): void => {
    it("closes a burst a minute after its latest removal, sending its total", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports, removals, runSchedule } = scenario();
        await removals([0, 10 * SECOND, 20 * SECOND]);
        await removals([30 * SECOND], "spamlink");

        await runSchedule();

        expect(ports.summaries).toStrictEqual([
            {
                account: MOD_A,
                actor: "moderator",
                tally: { comments: 3, posts: 1, spam: 1 },
                opened: OPENED,
                last: OPENED + 30 * SECOND,
                final: true,
            },
        ]);
        await expect(ports.bursts.read(MOD_A)).resolves.toBeUndefined();
    });

    it(
        "sends nothing when only the removal that opened the burst was counted",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { ports, removals, runSchedule } = scenario();
            await removals([0]);

            await runSchedule();

            expect(ports.summaries).toStrictEqual([]);
            await expect(ports.bursts.read(MOD_A)).resolves.toBeUndefined();
        },
    );

    it("sends running totals every five minutes while the burst goes on", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports, removals, runSchedule } = scenario();
        // A removal every 30 seconds for 12 minutes.
        await removals(every(30 * SECOND, 25));

        await runSchedule();

        // The run at five minutes comes before that moment's removal: 10 so far, then 20 at ten minutes, then all 25.
        expect(ports.summaries.map(({ tally, final }): readonly unknown[] => [tally.comments, final])).toStrictEqual([
            [10, false],
            [20, false],
            [25, true],
        ]);
    });

    it("does once what the scheduler delivers twice at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports, removals, run } = scenario();
        // A removal every 30 seconds until just before five minutes: the next run is due at five, to send progress.
        await removals(every(30 * SECOND, 10));
        const due = OPENED + 5 * MINUTE;

        await Promise.all([run(due, due), run(due, due)]);

        expect(ports.summaries).toHaveLength(1);
    });

    it("does nothing when a later run has taken the burst over", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports, removals, run } = scenario();
        await removals([0, SECOND]);

        await run(OPENED + 30 * SECOND, OPENED + 2 * MINUTE);

        expect(ports.summaries).toStrictEqual([]);
        await expect(ports.bursts.read(MOD_A)).resolves.toMatchObject({ counts: { removecomment: 2 } });
    });

    it(
        "closes the burst at once, sending its total, when the next run cannot be scheduled",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { ports, removals, run } = scenario();
            await removals([0, 50 * SECOND]);
            vi.mocked(ports.burstSchedule.summariseAt).mockRejectedValueOnce(FAILURE);

            await run(OPENED + MINUTE, OPENED + MINUTE);

            expect(ports.summaries.map(({ final }): boolean => final)).toStrictEqual([true]);
            expect(console.warn).toHaveBeenCalledWith(
                "[burst] Could not schedule a burst's next summary, so closing it now:",
                FAILURE,
            );
        },
    );

    it("tells a burst by one of Reddit's accounts as Reddit's", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports, removals, run } = scenario();
        const admins = { subredditName: "testsub", moderatorName: "Anti-Evil Operations" };
        await removals([0, SECOND], "removecomment", admins);

        await run(OPENED + MINUTE, OPENED + 2 * MINUTE, admins);

        expect(ports.summaries.map(({ actor }): string => actor)).toStrictEqual(["reddit"]);
    });
});
