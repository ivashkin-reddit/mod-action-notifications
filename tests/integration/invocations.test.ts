import { describe, expect, it, vi } from "vitest";
import { drive, loadApp } from "../fixtures/app.js";
import { commentDeleteEvent, removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const MINUTE = 60_000;
const AREA = "[invocation] ";

/** The completion lines logged at a level, parsed. */
function completionLines(level: "error" | "warn" | "info"): readonly Readonly<Record<string, unknown>>[] {
    return vi
        .mocked(console[level])
        .mock.calls.map(([first]: readonly unknown[]): unknown => first)
        .filter((line: unknown): line is string => typeof line === "string" && line.startsWith(AREA))
        .map((line: string): Readonly<Record<string, unknown>> => {
            const parsed: unknown = JSON.parse(line.slice(AREA.length));
            return typeof parsed === "object" && parsed !== null ? Object.fromEntries(Object.entries(parsed)) : {};
        });
}

/** Every completion line, at every level. */
function allCompletionLines(): readonly Readonly<Record<string, unknown>>[] {
    return [...completionLines("error"), ...completionLines("warn"), ...completionLines("info")];
}

describe("an invocation's completion line", (): void => {
    it("is not logged for one that succeeds, while Debug Logging is off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost());

        expect(allCompletionLines()).toStrictEqual([]);
    });

    it(
        "is logged for each one while Debug Logging is on, with what it cost, and no content or username",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { debugLogging: true });
            const event = removedPost({ moderator: { name: "Moderator7" }, targetUser: { name: "Poster9" } });

            await app.fire("ModAction", event);

            const [line] = completionLines("info");

            expect(line).toMatchObject({
                handler: "ModAction",
                subreddit: "t5_testsub",
                target: "t3_abc",
                outcome: "ok",
                alerts: 1,
                slack: { n: 1 },
                reddit: { n: 1 },
                failedCalls: 0,
            });
            expect(line?.["id"]).toMatch(/^[\da-z]{8}$/u);
            expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/Hello world|Moderator7|Poster9/u);
        },
    );

    // A comment deletion reads no settings: its line follows Debug Logging as the installation last read it.
    it(
        "is logged for an invocation that reads no settings, while Debug Logging was last read as on",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { debugLogging: true });

            await app.fire("ModAction", removedPost());
            await app.fire("CommentDelete", commentDeleteEvent({ commentId: "t1_x", postId: "t3_abc" }));

            expect(completionLines("info").map(({ handler }): unknown => handler)).toStrictEqual([
                "ModAction",
                "CommentDelete",
            ]);
        },
    );

    it("is logged for a menu item, named by its label", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { debugLogging: true });

        await app.pressMenuItem("Show Bot Status");

        expect(completionLines("info")).toMatchObject([{ handler: "menu:Show Bot Status", outcome: "ok" }]);
    });

    it(
        "is logged as an error for one that fails, naming the call that failed, and the handler still rejects",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            const failure = new Error("redis down");
            // The mod action's handler rejects at its first read of the connection.
            app.context.redis.get.mockRejectedValue(failure);

            await expect(app.fire("ModAction", removedPost())).rejects.toBe(failure);
            expect(completionLines("error")).toMatchObject([
                {
                    handler: "ModAction",
                    outcome: "failed",
                    failedCalls: 1,
                    error: { code: "redis-failed", class: "Error", stage: "redis.get" },
                    message: "redis down",
                },
            ]);
        },
    );

    // An outage fails every event: one line a minute for each handler, counting those held back.
    it("is logged at most once a minute for a handler that keeps failing", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.get.mockRejectedValue(new Error("redis down"));

        await app.fire("ModAction", removedPost({ id: "ModAction_1" })).catch((): void => undefined);
        await app.fire("ModAction", removedPost({ id: "ModAction_2" })).catch((): void => undefined);
        await app.fire("ModAction", removedPost({ id: "ModAction_3" })).catch((): void => undefined);
        await app.advance(MINUTE);
        await app.fire("ModAction", removedPost({ id: "ModAction_4" })).catch((): void => undefined);

        expect(completionLines("error").map(({ heldBack }): unknown => heldBack)).toStrictEqual([undefined, 2]);
    });

    it(
        "is logged as a warning for one that takes 20 seconds or more, with its slowest call",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            // Slack takes 25 seconds to take the alert the mod action sends.
            app.slack.respondSlowly(25_000, 200);

            await drive(app.fire("ModAction", removedPost()));

            expect(completionLines("warn")).toMatchObject([
                { handler: "ModAction", outcome: "ok", slowest: "slack.chat.postMessage 25000ms" },
            ]);
        },
    );
});
