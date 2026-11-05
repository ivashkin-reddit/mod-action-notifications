import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { SlackMessage } from "../fixtures/fakeSlack.js";
import { lastLine, lines, MINUTE, onlyMessage, WHEN_NOW } from "../fixtures/messages.js";
import { keysBesidesBookkeeping } from "../fixtures/redisKeys.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const ACTIVITY_KEY = "mod_actions:moderator_actions:testsub:moda";

/** Each message's status line, if it has one. */
function statusLines(
    app: Readonly<{ slack: Readonly<{ messages: readonly SlackMessage[] }> }>,
): (string | undefined)[] {
    return app.slack.messages.map((message: SlackMessage): string | undefined =>
        lines(message).find((line: string): boolean => line.startsWith("• *Status:*")),
    );
}

describe("an activity spike", (): void => {
    it("is flagged on a moderator’s fifth action within a minute", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        for (let count = 0; count < 5; count += 1) {
            await app.fire("ModAction", removedPost());
            await app.advance(10_000);
        }

        expect(statusLines(app)).toStrictEqual([
            undefined,
            undefined,
            undefined,
            undefined,
            "• *Status:* Activity spike 5 actions / 1 min",
        ]);
    });

    it("keeps each moderator’s recent actions in Redis for an hour, by ID", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

        expect(keysBesidesBookkeeping(app.context.redis)).toStrictEqual([
            ACTIVITY_KEY,
            "mod_actions:reported:ModAction_1",
        ]);
        await expect(app.context.redis.zRange(ACTIVITY_KEY, 0, NOW.getTime(), { by: "score" })).resolves.toStrictEqual([
            { member: "ModAction_1", score: NOW.getTime() },
        ]);
        expect(app.context.redis.ttlSeconds(ACTIVITY_KEY)).toBe(3600);
    });

    // Devvit runs triggers concurrently, and a burst of actions is what a spike is.
    it("counts every one of a burst of actions that arrive at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await Promise.all(
            Array.from({ length: 5 }, async (_unused: unknown, index: number): Promise<void> => {
                await app.fire("ModAction", removedPost({ id: `ModAction_${String(index)}` }));
            }),
        );

        expect(statusLines(app)).toContain("• *Status:* Activity spike 5 actions / 1 min");
    });

    it("counts an action delivered again once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        for (let count = 0; count < 5; count += 1) {
            await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        }
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));

        // One alert for each action, and the second is the moderator's second action, not their sixth.
        expect(statusLines(app)).toStrictEqual([undefined, undefined]);
    });

    // A backlog Devvit delivers at once is not a burst: actions count by when they were taken.
    it("counts actions by when they were taken, not when they arrive", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        for (let minutesAgo = 20; minutesAgo >= 0; minutesAgo -= 5) {
            await app.fire("ModAction", removedPost({ actionedAt: new Date(NOW.getTime() - minutesAgo * MINUTE) }));
        }

        expect(statusLines(app)).toStrictEqual([undefined, undefined, undefined, undefined, undefined]);
    });

    it("counts an action exactly a minute old but not one older", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        for (let count = 0; count < 4; count += 1) {
            await app.fire("ModAction", removedPost({ actionedAt: NOW }));
        }
        await app.fire("ModAction", removedPost({ actionedAt: new Date(NOW.getTime() + MINUTE) }));
        await app.fire("ModAction", removedPost({ actionedAt: new Date(NOW.getTime() + MINUTE + 1) }));

        expect(lastLine(app.slack.messages[4])).toBe("• *Status:* Activity spike 5 actions / 1 min");
        expect(lastLine(app.slack.messages[5])).toBe(WHEN_NOW.replace("12:00:00", "12:01:00"));
    });

    it(
        "counts actions that are not sent: types not enabled and excluded moderators",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { excludedModerators: "ModA" });

            for (let count = 0; count < 4; count += 1) {
                await app.fire("ModAction", removedPost({ action: "lock" }));
            }
            app.settings.excludedModerators = "";
            await app.fire("ModAction", removedPost());

            expect(lastLine(onlyMessage(app.slack.messages))).toBe("• *Status:* Activity spike 5 actions / 1 min");
        },
    );

    it("keeps at most the 100 most recent actions", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        for (let count = 0; count < 105; count += 1) {
            await app.fire("ModAction", removedPost({ actionedAt: NOW }));
        }

        await expect(app.context.redis.zRange(ACTIVITY_KEY, 0, NOW.getTime(), { by: "score" })).resolves.toHaveLength(
            100,
        );
        expect(lastLine(app.slack.messages[104])).toBe("• *Status:* Activity spike 100 actions / 1 min");
    });

    // Earlier versions kept a JSON list of times under mod_actions:moderator_activity:*; it expires within the hour.
    it("ignores the activity list an earlier version kept", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const legacyTimes = JSON.stringify(Array<number>(4).fill(NOW.getTime()));
        app.context.redis.seed("mod_actions:moderator_activity:testsub:moda", legacyTimes);

        await app.fire("ModAction", removedPost());

        expect(lastLine(onlyMessage(app.slack.messages))).toBe(WHEN_NOW);
    });

    it("is not tracked when the event names no subreddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ subreddit: undefined }));

        expect(keysBesidesBookkeeping(app.context.redis)).toStrictEqual([]);
        expect(app.slack.requests).toHaveLength(1);
    });

    it("does not stop the message when Redis fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.zAdd.mockRejectedValue(new Error("redis down"));

        await app.fire("ModAction", removedPost());

        expect(lastLine(onlyMessage(app.slack.messages))).toBe(WHEN_NOW);
    });
});
