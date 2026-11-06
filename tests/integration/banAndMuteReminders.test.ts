import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { bannedUser, modActionEvent } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { SlackMessage } from "../fixtures/fakeSlack.js";
import { lines, MINUTE, onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const BAN_EVENTS_KEY = "mod_actions:discipline_events:ban:testsub:troll";
const DAY = 24 * 60 * MINUTE;

function unbanAt(actionedAt: Date): ReturnType<typeof modActionEvent> {
    return modActionEvent({
        action: "unbanuser",
        actionedAt,
        moderator: { name: "ModB" },
        targetUser: { name: "Troll" },
    });
}

function relatedBan(message: SlackMessage | undefined): string | undefined {
    return lines(message).find((line: string): boolean => line.startsWith("• *Related Ban:*"));
}

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

    // The note is shown, where the setting allows it, in the alert for the ban itself.
    it.each([
        ["on", true],
        ["off", false],
    ])(
        "reminds moderators of the ban's length, never its note, with mod notes %s",
        TEST_OPTIONS,
        async (_label: string, includeModNote: boolean): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { includeModNote });
            app.context.reddit.modLog = [
                {
                    id: "ModAction_1",
                    moderatorName: "ModA",
                    createdAt: NOW,
                    description: "Spamming",
                    target: { author: "Troll" },
                },
            ];
            await app.fire("ModAction", bannedUser());
            await app.advance(DAY);

            await app.fire("ModAction", unbanAt(new Date(NOW.getTime() + DAY)));

            expect(relatedBan(app.slack.messages[1])).toBe(
                "• *Related Ban:* Moderator <https://www.reddit.com/u/ModA|u/ModA> • on 2026-11-04T12:00:00.000Z",
            );
            expect(JSON.stringify(app.slack.messages[1])).not.toContain("Spamming");
        },
    );

    it(
        "keeps bans and unbans in Redis for 90 days, and reminds of a ban only once",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire("ModAction", bannedUser());

            expect(app.context.redis.ttlSeconds(BAN_EVENTS_KEY)).toBe(90 * 24 * 60 * 60);
            await expect(app.context.redis.zRange(BAN_EVENTS_KEY, 0, -1, { by: "rank" })).resolves.toStrictEqual([
                {
                    member: JSON.stringify({
                        change: "imposed",
                        at: NOW.getTime(),
                        moderatorName: "ModA",
                        description: "",
                        details: null,
                    }),
                    score: NOW.getTime(),
                },
            ]);

            const unban = modActionEvent({
                action: "unbanuser",
                moderator: { name: "ModB" },
                targetUser: { name: "Troll" },
            });
            await app.fire("ModAction", unban);
            await app.fire("ModAction", unban);

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

        expect(app.context.redis.keys()).toContain("mod_actions:discipline_events:mute:testsub:troll");

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
        app.context.redis.zAdd.mockRejectedValue(new Error("redis down"));
        app.context.redis.zRange.mockRejectedValue(new Error("redis down"));

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

// Devvit can deliver a ban after the unban that lifted it, or both at once; events are placed by when they were taken.
describe("bans and unbans arriving out of order", (): void => {
    it("never remind of a ban that arrived after the unban that lifted it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", unbanAt(new Date(NOW.getTime() + MINUTE)));
        await app.fire("ModAction", bannedUser({ actionedAt: NOW }));
        await app.fire("ModAction", unbanAt(new Date(NOW.getTime() + DAY)));

        expect(app.slack.messages.map(relatedBan)).toStrictEqual([undefined, undefined, undefined]);
    });

    it(
        "remind of the latest ban taken before the unban, whatever order they arrived in",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            await app.fire(
                "ModAction",
                bannedUser({ actionedAt: new Date(NOW.getTime() + DAY), moderator: { name: "ModB" } }),
            );
            await app.fire("ModAction", bannedUser({ actionedAt: NOW }));
            await app.fire("ModAction", unbanAt(new Date(NOW.getTime() + MINUTE)));

            expect(relatedBan(app.slack.messages[2])).toBe(
                "• *Related Ban:* Moderator <https://www.reddit.com/u/ModA|u/ModA> • on 2026-11-04T12:00:00.000Z",
            );
        },
    );

    it("keep both a ban and its unban that arrive at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await Promise.all([
            app.fire("ModAction", bannedUser({ actionedAt: NOW })),
            app.fire("ModAction", unbanAt(new Date(NOW.getTime() + MINUTE))),
        ]);

        await expect(app.context.redis.zRange(BAN_EVENTS_KEY, 0, -1, { by: "rank" })).resolves.toHaveLength(2);
    });
});

describe("a ban an earlier version stored", (): void => {
    it("is carried over, and the unban reminds moderators of it", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.context.redis.seed(
            "mod_actions:discipline:ban:testsub:troll",
            JSON.stringify({
                type: "ban",
                moderatorName: "ModA",
                timestamp: NOW.getTime() - DAY,
                description: "Spamming",
                details: "7 days",
            }),
        );

        await app.fire("ModAction", unbanAt(NOW));

        expect(relatedBan(onlyMessage(app.slack.messages))).toBe(
            "• *Related Ban:* Moderator <https://www.reddit.com/u/ModA|u/ModA> • on 2026-11-03T12:00:00.000Z • Details 7 days",
        );
        expect(
            app.context.redis.keys().filter((key): boolean => key.startsWith("mod_actions:discipline")),
        ).toStrictEqual([BAN_EVENTS_KEY]);
    });

    it("skip a stored event they cannot read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.context.redis.zAdd(BAN_EVENTS_KEY, { member: "not json", score: NOW.getTime() });

        await app.fire("ModAction", unbanAt(new Date(NOW.getTime() + MINUTE)));

        expect(relatedBan(onlyMessage(app.slack.messages))).toBeUndefined();
    });
});
