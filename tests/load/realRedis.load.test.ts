import { describe, expect, it } from "vitest";
import { connectRedis, viewFor } from "./realRedis.js";
import type { LoadRedis, RedisClient } from "./realRedis.js";

const REDIS_URL = process.env["LOAD_REDIS_URL"] ?? "redis://localhost:6390";
const TEST_OPTIONS = { timeout: 30_000 };

/** An emptied Redis, and the adapter's view of it. */
async function emptied(): Promise<Readonly<{ client: RedisClient; redis: LoadRedis }>> {
    const client = await connectRedis(REDIS_URL);
    await client.sendCommand(["FLUSHDB"]);
    return { client, redis: viewFor(client, { sent: 0, received: 0 }) };
}

// The adapter must answer as Devvit's client does, or the app misreads what it stored and the measurements mean nothing.
describe("the real-Redis adapter", (): void => {
    it("answers strings in Devvit's shapes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { client, redis } = await emptied();

        await expect(redis.set("k", "v", { nx: true })).resolves.toBe("OK");
        await expect(redis.set("k", "w", { nx: true })).resolves.toBe("");
        await expect(redis.get("k")).resolves.toBe("v");
        await expect(redis.get("missing")).resolves.toBeUndefined();
        await expect(redis.mGet(["k", "missing"])).resolves.toStrictEqual(["v", null]);

        await client.quit();
    });

    // As the burst records queue one: Devvit's exec answers numbers, strings, and null for nil, in order.
    it("answers a transaction's results and RENAME in Devvit's shapes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { client, redis } = await emptied();
        const join = async (): Promise<unknown[]> => {
            const tx = await redis.watch("unwritten");
            await tx.multi();
            await tx.hSetNX("b", "opened", "100");
            await tx.hIncrBy("b", "removecomment", 1);
            await tx.hSet("b", { last: "100" });
            await tx.expire("b", 3600);
            await tx.hGet("b", "due");
            await tx.hGet("b", "opened");
            return await tx.exec();
        };

        await expect(join()).resolves.toStrictEqual([1, 1, 1, 1, null, "100"]);
        await expect(join()).resolves.toStrictEqual([0, 2, 0, 1, null, "100"]);
        await expect(redis.rename("b", "c")).resolves.toBe("OK");
        await expect(redis.hGetAll("c")).resolves.toMatchObject({ removecomment: "2" });
        await expect(redis.rename("b", "d")).rejects.toThrow("no such key");

        await client.quit();
    });

    it("answers hashes in Devvit's shapes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { client, redis } = await emptied();
        await redis.hSet("h", { a: "1", b: "2" });

        await expect(redis.hGetAll("h")).resolves.toStrictEqual({ a: "1", b: "2" });
        await expect(redis.hScan("h", 0)).resolves.toMatchObject({ cursor: 0 });

        await client.quit();
    });

    it("answers sorted sets in Devvit's shapes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const { client, redis } = await emptied();
        await redis.zAdd("z", { member: "x", score: 2 }, { member: "y", score: 1 });
        await redis.zAdd("lex", { member: "a 1", score: 0 }, { member: "b 1", score: 0 });

        await expect(redis.zRange("z", 0, -1, { by: "rank" })).resolves.toStrictEqual([
            { member: "y", score: 1 },
            { member: "x", score: 2 },
        ]);
        await expect(redis.zRange("z", 0, 1, { by: "score" })).resolves.toStrictEqual([{ member: "y", score: 1 }]);
        await expect(redis.zRange("lex", "[a ", "(a!", { by: "lex" })).resolves.toStrictEqual([
            { member: "a 1", score: 0 },
        ]);
        await expect(redis.zScore("z", "x")).resolves.toBe(2);
        await expect(redis.zScore("z", "missing")).resolves.toBeUndefined();

        await client.quit();
    });
});
