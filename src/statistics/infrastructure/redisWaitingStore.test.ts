import { describe, expect, it } from "vitest";
import { createFakeRedis } from "../../../tests/fixtures/fakeRedis.js";
import { createRedisWaitingStore } from "./redisWaitingStore.js";

const TEST_OPTIONS = { timeout: 1000 };
const AT = Date.UTC(2026, 10, 4, 12);

describe("what waits for a moderator, in Redis", (): void => {
    it("is taken by one of two handlers that take it at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const store = createRedisWaitingStore(createFakeRedis());
        await store.markAwaiting("t3_abc", { at: AT, source: "report" });
        await store.markModmailWaiting("c1", AT);
        await store.noteRemoval("2026-11-04", "t3_abc", "reddit");

        const taken = await Promise.all([
            store.takeAwaiting("t3_abc"),
            store.takeAwaiting("t3_abc"),
            store.takeModmailWaiting("c1"),
            store.takeModmailWaiting("c1"),
            store.takeRemoval(["2026-11-04", "2026-11-03"], "t3_abc"),
            store.takeRemoval(["2026-11-04", "2026-11-03"], "t3_abc"),
        ]);

        expect(taken).toStrictEqual([{ at: AT, source: "report" }, undefined, AT, undefined, "reddit", undefined]);
    });

    it("keeps the first entry for an item", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const store = createRedisWaitingStore(createFakeRedis());
        await store.markAwaiting("t3_abc", { at: AT, source: "automoderator" });
        await store.markAwaiting("t3_abc", { at: AT + 1, source: "report" });

        await expect(store.takeAwaiting("t3_abc")).resolves.toStrictEqual({ at: AT, source: "automoderator" });
    });
});
