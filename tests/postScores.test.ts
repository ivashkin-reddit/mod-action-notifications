import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./support/app.js";
import { bigPost, postCreateEvent, postUpdateEvent } from "./support/events.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const CACHE_KEY = "post_score:t3_big";
const SEVEN_DAYS_SECONDS = 604_800;

describe("a new or updated post", (): void => {
    it(
        "is remembered for seven days once its score reaches half the deletion threshold",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire("PostCreate", postCreateEvent({ post: bigPost(50), author: { name: "Poster" } }));

            expect(app.context.redis.keys()).toStrictEqual([CACHE_KEY]);
            expect(app.context.redis.ttlSeconds(CACHE_KEY)).toBe(SEVEN_DAYS_SECONDS);
        },
    );

    // Devvit's PostV2 has authorId and subredditId but no authorName or subredditName, which the app reads.
    it("is remembered with its author and subreddit as Unknown", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("PostCreate", postCreateEvent({ post: bigPost(50), author: { name: "Poster" } }));

        expect(JSON.parse(String(await app.context.redis.get(CACHE_KEY)))).toStrictEqual({
            score: 50,
            title: "Big post",
            authorName: "Unknown",
            permalink: "/r/testsub/comments/big/big_post/",
            subredditName: "Unknown",
        });
    });

    it("is not remembered below half the deletion threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("PostCreate", postCreateEvent({ post: bigPost(49) }));

        expect(app.context.redis.keys()).toStrictEqual([]);
    });

    it("is remembered with its latest score as it is updated", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("PostCreate", postCreateEvent({ post: bigPost(60) }));
        await app.fire("PostUpdate", postUpdateEvent({ post: bigPost(150) }));

        expect(JSON.parse(String(await app.context.redis.get(CACHE_KEY)))).toMatchObject({ score: 150 });
    });

    it("is not remembered when deletion alerts are off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { postDeletionUpvoteThreshold: 0 });

        await app.fire("PostCreate", postCreateEvent({ post: bigPost(5000) }));

        expect(app.context.redis.keys()).toStrictEqual([]);
    });

    it.each([
        ["an event without a post", postCreateEvent({})],
        ["a post without an ID", postCreateEvent({ post: { score: 500 } })],
    ])("is ignored for %s", TEST_OPTIONS, async (_label: string, event: unknown): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("PostCreate", event);

        expect(app.context.redis.keys()).toStrictEqual([]);
    });

    it.each([
        ["200", 99, false],
        ["200", 100, true],
        [140.9, 70, true],
        ["not a number", 49, false],
        ["not a number", 50, true],
        [-5, 5000, false],
    ])(
        "reads a threshold setting of %j: a score of %i is remembered: %s",
        TEST_OPTIONS,
        async (threshold, score, remembered): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { postDeletionUpvoteThreshold: threshold });

            await app.fire("PostCreate", postCreateEvent({ post: bigPost(score) }));

            expect(app.context.redis.keys()).toStrictEqual(remembered ? [CACHE_KEY] : []);
        },
    );

    it("is not remembered when Redis fails, and the trigger still succeeds", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.set.mockRejectedValue(new Error("redis down"));

        await app.fire("PostCreate", postCreateEvent({ post: bigPost(500) }));

        expect(app.context.redis.keys()).toStrictEqual([]);
    });
});
