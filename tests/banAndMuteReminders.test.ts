import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "./support/app.js";
import { bannedUser, modActionEvent } from "./support/events.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";
import { lines, MINUTE, onlyMessage } from "./support/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("an unban or unmute", (): void => {
    it("reminds moderators of the ban it lifts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.reddit.modLog = [
            {
                id: "ModAction_1",
                moderatorName: "ModA",
                createdAt: NOW,
                details: "7 days",
                description: "Spamming",
                target: { author: "Troll" },
            },
        ];
        await app.fire("ModAction", bannedUser());
        await app.advance(24 * 60 * MINUTE);

        await app.fire(
            "ModAction",
            modActionEvent({ action: "unbanuser", moderator: { name: "ModB" }, targetUser: { name: "Troll" } }),
        );

        expect(lines(app.slack.messages[1])).toContain(
            "• *Related Ban:* Moderator <https://www.reddit.com/u/ModA|u/ModA> • on 2026-11-04T12:00:00.000Z • Details 7 days",
        );
    });

    it(
        "keeps the ban in Redis for 90 days, and forgets it once the user is unbanned",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            const key = "mod_actions:discipline:ban:testsub:troll";

            await app.fire("ModAction", bannedUser());

            expect(app.context.redis.ttlSeconds(key)).toBe(90 * 24 * 60 * 60);
            expect(JSON.parse(String(await app.context.redis.get(key)))).toStrictEqual({
                type: "ban",
                moderatorName: "ModA",
                timestamp: NOW.getTime(),
                description: "",
                details: null,
            });

            const unban = modActionEvent({
                action: "unbanuser",
                moderator: { name: "ModB" },
                targetUser: { name: "Troll" },
            });
            await app.fire("ModAction", unban);
            await app.fire("ModAction", unban);

            expect(app.context.redis.keys()).not.toContain(key);
            expect(lines(app.slack.messages[1])).toContain(
                "• *Related Ban:* Moderator <https://www.reddit.com/u/ModA|u/ModA> • on 2026-11-04T12:00:00.000Z",
            );
            expect(lines(app.slack.messages[2]).some((line): boolean => line.startsWith("• *Related Ban:*"))).toBe(
                false,
            );
        },
    );

    it("reminds moderators of the mute it lifts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: ["muteuser", "unmuteuser"] });

        await app.fire(
            "ModAction",
            modActionEvent({ action: "muteuser", moderator: { name: "ModA" }, targetUser: { name: "Troll" } }),
        );

        expect(app.context.redis.keys()).toContain("mod_actions:discipline:mute:testsub:troll");

        await app.fire(
            "ModAction",
            modActionEvent({ action: "unmuteuser", moderator: { name: "ModB" }, targetUser: { name: "Troll" } }),
        );

        expect(lines(app.slack.messages[1])).toContain(
            "• *Related Mute:* Moderator <https://www.reddit.com/u/ModA|u/ModA> • on 2026-11-04T12:00:00.000Z",
        );
    });

    it("remembers bans even when ban notifications are off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: ["unbanuser"] });

        await app.fire("ModAction", bannedUser());
        await app.fire(
            "ModAction",
            modActionEvent({ action: "unbanuser", moderator: { name: "ModB" }, targetUser: { name: "Troll" } }),
        );

        expect(
            lines(onlyMessage(app.slack.messages)).some((line): boolean => line.startsWith("• *Related Ban:*")),
        ).toBe(true);
    });

    it.each([["not json"], ["{}"]])(
        "says nothing about a stored ban it cannot use: %s",
        TEST_OPTIONS,
        async (stored): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            const key = "mod_actions:discipline:ban:testsub:troll";
            app.context.redis.seed(key, stored);

            await app.fire(
                "ModAction",
                modActionEvent({ action: "unbanuser", moderator: { name: "ModB" }, targetUser: { name: "Troll" } }),
            );

            expect(
                lines(onlyMessage(app.slack.messages)).some((line): boolean => line.startsWith("• *Related Ban:*")),
            ).toBe(false);
            expect(app.context.redis.keys()).not.toContain(key);
        },
    );

    it("is still sent when Redis fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.get.mockRejectedValue(new Error("redis down"));
        app.context.redis.set.mockRejectedValue(new Error("redis down"));

        await app.fire("ModAction", bannedUser());
        await app.fire(
            "ModAction",
            modActionEvent({ action: "unbanuser", moderator: { name: "ModB" }, targetUser: { name: "Troll" } }),
        );

        expect(app.slack.messages.map((message): string => message.text)).toStrictEqual([
            "🔨 User Banned",
            "🎉 User Unbanned",
        ]);
    });
});
