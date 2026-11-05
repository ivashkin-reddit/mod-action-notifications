import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { bigPost, removedPost, userDeletion } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { MINUTE } from "../fixtures/messages.js";
import { keysBesidesBookkeeping } from "../fixtures/redisKeys.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const DAY = 86_400_000;

// Devvit delivers a trigger at least once: the same event can arrive again, minutes later or at the same moment.

describe("a mod action delivered again", (): void => {
    it("is reported once when it arrives again later", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.advance(5 * MINUTE);
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

        expect(app.slack.messages).toHaveLength(1);
    });

    it("is reported once when both deliveries arrive at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await Promise.all([
            app.fire("ModAction", removedPost({ id: "ModAction_1" })),
            app.fire("ModAction", removedPost({ id: "ModAction_1" })),
        ]);

        expect(app.slack.messages).toHaveLength(1);
    });

    it("is remembered for a day", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

        expect(app.context.redis.ttlSeconds("mod_actions:reported:ModAction_1")).toBe(DAY / 1000);
    });

    it("leaves other actions by the same moderator to be reported", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        expect(app.slack.messages).toHaveLength(2);
    });

    // An action that cannot be told apart from another is reported each time.
    it("is reported each time when the event carries no ID", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "" }));
        await app.fire("ModAction", removedPost({ id: "" }));

        expect(app.slack.messages).toHaveLength(2);
    });

    it("is still reported, and logged, when its report cannot be recorded", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("redis down");
        app.context.redis.set.mockRejectedValueOnce(failure);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

        expect(app.slack.messages).toHaveLength(1);
        expect(console.warn).toHaveBeenCalledWith(
            "[modaction] Could not record that the action was alerted, so it may be alerted again:",
            failure,
        );
    });
});

describe("a post deletion delivered again", (): void => {
    it("is alerted once when it arrives again later", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(150)];

        await app.fire("PostDelete", userDeletion());
        await app.advance(5 * MINUTE);
        await app.fire("PostDelete", userDeletion());

        expect(app.slack.messages).toHaveLength(1);
    });

    it("is alerted once when both deliveries arrive at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(150)];

        await Promise.all([app.fire("PostDelete", userDeletion()), app.fire("PostDelete", userDeletion())]);

        expect(app.slack.messages).toHaveLength(1);
    });

    it("is still alerted, and logged, when its alert cannot be recorded", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(150)];
        const failure = new Error("redis down");
        app.context.redis.set.mockRejectedValueOnce(failure);

        await app.fire("PostDelete", userDeletion());

        expect(app.slack.messages).toHaveLength(1);
        expect(console.warn).toHaveBeenCalledWith(
            "[postdeletion] Could not record that the deletion was alerted, so it may be alerted again:",
            failure,
        );
    });

    it("records nothing for a deletion below the threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.posts = [bigPost(99)];

        await app.fire("PostDelete", userDeletion());

        expect(keysBesidesBookkeeping(app.context.redis)).toStrictEqual([]);
    });
});
