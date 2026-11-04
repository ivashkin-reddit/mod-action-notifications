import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "./support/app.js";
import { removedPost } from "./support/events.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";
import { lastLine, lines, MINUTE, onlyMessage, WHEN_NOW } from "./support/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("an activity spike", (): void => {
    it("is flagged on a moderator’s fifth action within a minute", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        for (let count = 0; count < 5; count += 1) {
            await app.fire("ModAction", removedPost());
            await app.advance(10_000);
        }

        const statusLines = app.slack.messages.map((message): string | undefined =>
            lines(message).find((line): boolean => line.startsWith("• *Status:*")),
        );

        expect(statusLines).toStrictEqual([
            undefined,
            undefined,
            undefined,
            undefined,
            "• *Status:* Activity spike 5 actions / 1 min",
        ]);
    });

    it("keeps each moderator’s recent actions in Redis for an hour", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost());

        const key = "mod_actions:moderator_activity:testsub:moda";

        expect(app.context.redis.keys()).toStrictEqual([key]);
        expect(JSON.parse(String(await app.context.redis.get(key)))).toStrictEqual([NOW.getTime()]);
        expect(app.context.redis.ttlSeconds(key)).toBe(3600);
    });

    it("counts an action exactly a minute old but not one older", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        for (let count = 0; count < 4; count += 1) {
            await app.fire("ModAction", removedPost());
        }
        await app.advance(MINUTE);
        await app.fire("ModAction", removedPost());
        await app.advance(1);
        await app.fire("ModAction", removedPost());

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
        const key = "mod_actions:moderator_activity:testsub:moda";
        app.context.redis.seed(key, JSON.stringify(Array<number>(150).fill(NOW.getTime() - 1000)));

        await app.fire("ModAction", removedPost());

        const stored: unknown = JSON.parse(String(await app.context.redis.get(key)));

        expect(stored).toStrictEqual([...Array<number>(99).fill(NOW.getTime() - 1000), NOW.getTime()]);
        expect(lastLine(onlyMessage(app.slack.messages))).toBe("• *Status:* Activity spike 100 actions / 1 min");
    });

    it.each([["not json"], ['{"count":4}'], ['["a", "b", "c", "d"]']])(
        "starts counting afresh when the stored activity is unusable: %s",
        TEST_OPTIONS,
        async (stored): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.redis.seed("mod_actions:moderator_activity:testsub:moda", stored);

            await app.fire("ModAction", removedPost());

            expect(lastLine(onlyMessage(app.slack.messages))).toBe(WHEN_NOW);
        },
    );

    it("is not tracked when the event names no subreddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ subreddit: undefined }));

        expect(app.context.redis.keys()).toStrictEqual([]);
        expect(app.slack.requests).toHaveLength(1);
    });

    it("does not stop the message when Redis fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.get.mockRejectedValue(new Error("redis down"));

        await app.fire("ModAction", removedPost());

        expect(app.slack.requests).toHaveLength(1);
    });
});
