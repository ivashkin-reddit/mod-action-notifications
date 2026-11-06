import { describe, expect, it } from "vitest";
import { createFakeRedis } from "../../../tests/fixtures/fakeRedis.js";
import type { ActionTally } from "../domain/counting.js";
import { createRedisStatisticsStore } from "./redisStatisticsStore.js";

const TEST_OPTIONS = { timeout: 5000 };
const DAY = "2026-11-04";

function removalOn(postId: string): ActionTally {
    return {
        day: DAY,
        actionField: "moderators:removecomment",
        hour: 12,
        moderatorHash: "0000abcd",
        banCounts: {},
        removedFrom: postId,
    };
}

describe("the threads a day's removals were on, in Redis", (): void => {
    // Equal counts rank by ID, and older posts' IDs sort first: a cut to the top 100 dropped an older thread's first
    // removal every time, so a megathread busy all day could never count past one.
    it(
        "counts an older thread's removals after a hundred newer threads had one each",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const store = createRedisStatisticsStore(createFakeRedis());
            for (const index of Array.from({ length: 100 }, (_unused: unknown, at: number): number => at)) {
                await store.addTally(removalOn(`t3_b${String(index).padStart(3, "0")}`));
            }

            await store.addTally(removalOn("t3_a000"));
            await store.addTally(removalOn("t3_a000"));

            const { threads } = await store.dayCounts(DAY);

            expect(threads).toContainEqual({ postId: "t3_a000", removals: 2 });
        },
    );
});
