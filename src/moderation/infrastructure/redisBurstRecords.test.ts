import { describe, expect, it, vi } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import { createFakeRedis } from "../../../tests/fixtures/fakeRedis.js";
import type { FakeTransaction } from "../../../tests/fixtures/fakeRedis.js";
import { createRedisBurstRecords } from "./redisBurstRecords.js";

const TEST_OPTIONS = { timeout: 1000 };
const AT = NOW.getTime();
const MOD_A = { subredditName: "TestSub", moderatorName: "Anti-Evil Operations" };
const BURST_KEY = "mod_actions:burst:testsub:anti-evil_operations";
const HOUR_SECONDS = 3600;

function fakes(): Readonly<{
    redis: ReturnType<typeof createFakeRedis>;
    records: ReturnType<typeof createRedisBurstRecords>;
}> {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    const redis = createFakeRedis();
    return { redis, records: createRedisBurstRecords(redis) };
}

describe("a burst kept in Redis", (): void => {
    it("is opened by the first removal, and counted by each", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { records } = fakes();

        const first = await records.join(MOD_A, "removecomment", AT);
        const second = await records.join(MOD_A, "spamlink", AT + 1000);

        expect([first, second]).toStrictEqual([
            { opened: true, openedAt: AT, due: undefined },
            { opened: false, openedAt: AT, due: undefined },
        ]);
        await expect(records.read(MOD_A)).resolves.toStrictEqual({
            opened: AT,
            last: AT + 1000,
            due: undefined,
            progressAt: undefined,
            counts: { removelink: 0, removecomment: 1, spamlink: 1, spamcomment: 0 },
        });
    });

    it(
        "keeps its due time and progress, and lives an hour after its last write",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { records, redis } = fakes();
            await records.join(MOD_A, "removecomment", AT);
            // Ten minutes on, a write keeps the burst another hour.
            vi.setSystemTime(AT + 600_000);

            await records.setDue(MOD_A, AT + 60_000);
            await records.noteProgress(MOD_A, AT + 300_000);

            await expect(records.read(MOD_A)).resolves.toMatchObject({ due: AT + 60_000, progressAt: AT + 300_000 });
            expect(redis.ttlSeconds(BURST_KEY)).toBe(HOUR_SECONDS);
        },
    );

    it(
        "is closed whole, leaving nothing, and the next removal opens another",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { records, redis } = fakes();
            await records.join(MOD_A, "removecomment", AT);
            await records.join(MOD_A, "removecomment", AT + 1000);

            const closed = await records.close(MOD_A, AT + 61_000);

            expect(closed?.counts.removecomment).toBe(2);
            expect(redis.keys()).toStrictEqual([]);
            await expect(records.join(MOD_A, "removelink", AT + 70_000)).resolves.toMatchObject({ opened: true });
        },
    );

    it("is none to close when none is open", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { records } = fakes();

        await expect(records.close(MOD_A, AT)).resolves.toBeUndefined();
    });

    it("lets each run and each rescue be claimed once, for an hour", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { records, redis } = fakes();

        const runs = [await records.claimRun(MOD_A, AT), await records.claimRun(MOD_A, AT)];
        const rescues = [await records.claimRescue(MOD_A, AT), await records.claimRescue(MOD_A, AT)];

        expect([runs, rescues]).toStrictEqual([
            [true, false],
            [true, false],
        ]);
        expect(redis.ttlSeconds(`mod_actions:burst_run:testsub:anti-evil_operations:${String(AT)}`)).toBe(HOUR_SECONDS);
    });

    it("is not counted from a transaction that answers short", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { records, redis } = fakes();
        const realWatch = redis.watch.getMockImplementation();
        redis.watch.mockImplementationOnce(async (key: string): Promise<FakeTransaction> => {
            if (realWatch === undefined) {
                throw new Error("the fake Redis has no WATCH");
            }
            const tx = await realWatch(key);
            tx.exec.mockResolvedValueOnce([1]);
            return tx;
        });

        await expect(records.join(MOD_A, "removecomment", AT)).rejects.toThrow(
            "a burst's transaction answered 1 results for 6",
        );
    });
});
