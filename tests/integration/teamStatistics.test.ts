import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { bannedUser, modActionEvent, removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const DAY = "2026-11-04";
const FIFTEEN_DAYS = 15 * 86_400;

describe("team statistics", (): void => {
    it("count each mod action by who took it and its type, for its day", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2", moderator: { name: "AutoModerator" } }));
        await app.fire("ModAction", removedPost({ id: "ModAction_3", moderator: { name: "reddit" } }));

        await expect(app.context.redis.hGetAll(`stats:actions:${DAY}`)).resolves.toStrictEqual({
            "moderators:removelink": "1",
            "automoderator:removelink": "1",
            "reddit:removelink": "1",
        });
        expect(app.context.redis.ttlSeconds(`stats:actions:${DAY}`)).toBe(FIFTEEN_DAYS);
    });

    it("count moderators' actions by UTC hour, leaving out AutoModerator's", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2", moderator: { name: "AutoModerator" } }));

        await expect(app.context.redis.hGetAll(`stats:hours:${DAY}`)).resolves.toStrictEqual({ "12": "1" });
    });

    it("count an action Devvit delivers twice once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

        await expect(app.context.redis.hGetAll(`stats:actions:${DAY}`)).resolves.toStrictEqual({
            "moderators:removelink": "1",
        });
    });

    it("count bans by length, and unbans", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modLog = [
            {
                id: "ModAction_1",
                moderatorName: "ModA",
                createdAt: NOW,
                details: "7 days",
                target: { author: "Troll" },
            },
            {
                id: "ModAction_2",
                moderatorName: "ModA",
                createdAt: NOW,
                details: "permanent",
                target: { author: "Pest" },
            },
        ];

        await app.fire("ModAction", bannedUser({ id: "ModAction_1" }));
        await app.fire("ModAction", bannedUser({ id: "ModAction_2", targetUser: { name: "Pest" } }));
        await app.fire(
            "ModAction",
            modActionEvent({
                id: "ModAction_3",
                action: "unbanuser",
                moderator: { name: "ModB" },
                targetUser: { name: "Troll" },
            }),
        );

        await expect(app.context.redis.hGetAll(`stats:bans:${DAY}`)).resolves.toStrictEqual({
            bans: "2",
            temporary: "1",
            banDays: "7",
            permanent: "1",
            unbans: "1",
        });
    });

    it("count removals on each thread", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2", action: "spamlink" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_3", action: "approvelink" }));

        await expect(app.context.redis.zScore(`stats:threads:${DAY}`, "t3_abc")).resolves.toBe(2);
    });

    it("count the moderators who acted without keeping their names", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_2" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_3", moderator: { name: "ModB" } }));
        await app.fire("ModAction", removedPost({ id: "ModAction_4", moderator: { name: "AutoModerator" } }));

        const active = await app.context.redis.zRange(`stats:active:${DAY}`, 0, -1, { by: "rank" });

        expect(active).toHaveLength(2);
        expect(active.every(({ member }): boolean => /^[\da-f]{8}$/u.test(member))).toBe(true);
    });

    // Statistics are team-level: no record names a moderator.
    it("keep no moderator's name anywhere", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.fire("ModAction", bannedUser({ id: "ModAction_2" }));

        const statsKeys = app.context.redis.keys().filter((key: string): boolean => key.startsWith("stats:"));
        const stored = statsKeys.map((key: string): string => JSON.stringify(app.context.redis.dump(key)));

        expect(statsKeys.length).toBeGreaterThan(0);
        expect([...statsKeys, ...stored].join(" ")).not.toMatch(/\b(?:author|moda|troll)\b/iu);
    });

    it("are counted while Slack is not set up", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackBotToken: undefined });

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

        await expect(app.context.redis.hGetAll(`stats:actions:${DAY}`)).resolves.toStrictEqual({
            "moderators:removelink": "1",
        });
    });
});
