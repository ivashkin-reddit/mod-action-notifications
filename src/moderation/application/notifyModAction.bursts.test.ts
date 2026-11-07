import { describe, expect, it, vi } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import { modAction } from "../../../tests/fixtures/modActions.js";
import { workingPorts } from "../../../tests/fixtures/moderationPorts.js";
import type { ModAction } from "../domain/modAction.js";
import { notifyModAction } from "./notifyModAction.js";
import type { ModerationConfig } from "./notifyModAction.js";

const TEST_OPTIONS = { timeout: 1000 };
const MINUTE = 60_000;
const FAILURE = new Error("scheduler down");
/** The count of a moderator's actions in the last minute that makes a spike. */
const AT_SPIKE = 5;
const MOD_A = { subredditName: "testsub", moderatorName: "ModA" };

const CONFIG: ModerationConfig = {
    enabledActions: ["removelink", "removecomment", "banuser"],
    excludedModerators: [],
    enableAutoModAlerts: false,
    securityAlerts: false,
    banHistoryDays: 0,
    flagUnknownModerators: true,
};

/** Working ports, with every action counted as the moderator's `count`th in a minute, and a way to notify them. */
function atRate(
    count: number = AT_SPIKE,
    moderators: readonly string[] = ["ModA"],
): Readonly<{ ports: ReturnType<typeof workingPorts>; notifyEach: (actions: readonly ModAction[]) => Promise<void> }> {
    const ports = workingPorts(moderators);
    vi.mocked(ports.records.countAction).mockResolvedValue(count);
    return {
        ports,
        notifyEach: async (actions: readonly ModAction[]): Promise<void> => {
            for (const action of actions) {
                await notifyModAction(action, CONFIG, ports);
            }
        },
    };
}

function removal(index: number, fields: Readonly<Partial<ModAction>> = {}): ModAction {
    return modAction({ id: `ModAction_${String(index)}`, ...fields });
}

describe("a removal at the spike rate", (): void => {
    it(
        "opens its moderator's burst, alerted with the burst line, and schedules the summary a minute on",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
            const { ports } = atRate();

            await notifyModAction(removal(1), CONFIG, ports);

            expect(ports.reports.map(({ opensBurst }): boolean => opensBurst)).toStrictEqual([true]);
            expect(ports.scheduled).toStrictEqual([{ account: MOD_A, due: NOW.getTime() + MINUTE }]);
        },
    );

    it("is held for the summary once the burst is open", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports, notifyEach } = atRate();

        await notifyEach([1, 2, 3, 4, 5].map((index: number): ModAction => removal(index)));

        expect(ports.reports).toHaveLength(1);
        await expect(ports.bursts.read(MOD_A)).resolves.toMatchObject({ counts: { removelink: 5 } });
    });

    it("opens Reddit's admins' burst too, alerted as Reddit's", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports, notifyEach } = atRate();
        const sweep = [1, 2, 3].map((index: number): ModAction =>
            removal(index, { moderatorName: "Anti-Evil Operations" }),
        );

        await notifyEach(sweep);

        expect(ports.reports.map(({ actor, opensBurst }): readonly unknown[] => [actor, opensBurst])).toStrictEqual([
            ["reddit", true],
        ]);
    });

    it("is counted once when Devvit delivers it twice", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports, notifyEach } = atRate();

        await notifyEach([removal(1), removal(2), removal(2)]);

        await expect(ports.bursts.read(MOD_A)).resolves.toMatchObject({ counts: { removelink: 2 } });
    });
});

describe("a removal that joins no burst", (): void => {
    it.each<readonly [string, Readonly<Partial<ModAction>>, readonly string[]]>([
        ["by an account not on the mod list, a security alert", {}, []],
        ["a ban", { type: "banuser" }, ["ModA"]],
    ])("is each alerted on its own: %s", TEST_OPTIONS, async (_label, fields, moderators): Promise<void> => {
        expect.hasAssertions();

        const { ports, notifyEach } = atRate(AT_SPIKE, moderators);

        await notifyEach([1, 2, 3].map((index: number): ModAction => removal(index, fields)));

        expect(ports.reports.map(({ opensBurst }): boolean => opensBurst)).toStrictEqual([false, false, false]);
        expect(ports.scheduled).toStrictEqual([]);
    });

    it("is each alerted on its own below the spike", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports, notifyEach } = atRate(AT_SPIKE - 1);

        await notifyEach([removal(1), removal(2)]);

        expect(ports.reports.map(({ opensBurst }): boolean => opensBurst)).toStrictEqual([false, false]);
    });

    it("is alerted on its own, logged, when it cannot be counted", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports } = atRate();
        vi.mocked(ports.bursts.join).mockRejectedValueOnce(FAILURE);

        await notifyModAction(removal(1), CONFIG, ports);

        expect(ports.reports.map(({ opensBurst }): boolean => opensBurst)).toStrictEqual([false]);
        expect(console.warn).toHaveBeenCalledWith(
            "[burst] Could not count a removal in its burst, so alerting it on its own:",
            FAILURE,
        );
    });

    it(
        "is alerted on its own, with the burst forgotten, when its summary cannot be scheduled",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { ports, notifyEach } = atRate();
            vi.mocked(ports.burstSchedule.summariseAt).mockRejectedValueOnce(FAILURE);

            await notifyEach([removal(1), removal(2)]);

            // The first could not be scheduled, so the second opened the burst afresh.
            expect(ports.reports.map(({ opensBurst }): boolean => opensBurst)).toStrictEqual([false, true]);
            expect(console.warn).toHaveBeenCalledWith(
                "[burst] Could not schedule a burst's summary, so alerting its removals one by one:",
                FAILURE,
            );
        },
    );
});

describe("a burst whose summary was lost", (): void => {
    it("is scheduled again once, by the removals that find it overdue", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
        const { ports } = atRate();
        await notifyModAction(removal(1), CONFIG, ports);
        // Due a minute on; a minute after that it is overdue.
        vi.setSystemTime(NOW.getTime() + 2 * MINUTE + 1);

        // Two removals at once both find it overdue: one claims the rescue.
        await Promise.all([notifyModAction(removal(2), CONFIG, ports), notifyModAction(removal(3), CONFIG, ports)]);

        expect(ports.scheduled.map(({ due }): number => due - NOW.getTime())).toStrictEqual([
            MINUTE,
            2 * MINUTE + 1 + 1000,
        ]);
    });

    it("is left overdue, logged, when the rescue cannot be scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
        const { ports } = atRate();
        await notifyModAction(removal(1), CONFIG, ports);
        vi.setSystemTime(NOW.getTime() + 2 * MINUTE + 1);
        vi.mocked(ports.burstSchedule.summariseAt).mockRejectedValueOnce(FAILURE);

        await notifyModAction(removal(2), CONFIG, ports);

        expect(ports.reports).toHaveLength(1);
        expect(console.warn).toHaveBeenCalledWith(
            "[burst] Could not schedule an overdue burst summary again:",
            FAILURE,
        );
    });
});

describe("a burst that cannot be scheduled nor forgotten", (): void => {
    it("leaves the removal alerted on its own, both failures logged", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { ports } = atRate();
        const forgetting = new Error("storage down");
        vi.mocked(ports.burstSchedule.summariseAt).mockRejectedValueOnce(FAILURE);
        vi.mocked(ports.bursts.discard).mockRejectedValueOnce(forgetting);

        await notifyModAction(removal(1), CONFIG, ports);

        expect(ports.reports.map(({ opensBurst }): boolean => opensBurst)).toStrictEqual([false]);
        expect(console.warn).toHaveBeenCalledWith(
            "[burst] Could not forget a burst it could not schedule:",
            forgetting,
        );
    });
});
