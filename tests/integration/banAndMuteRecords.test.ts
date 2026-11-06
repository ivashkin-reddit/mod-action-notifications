import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { bannedUser, modActionEvent } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const BAN_EVENTS_KEY = "mod_actions:discipline_events:ban:testsub:troll";
const MUTE_EVENTS_KEY = "mod_actions:discipline_events:mute:testsub:troll";
const DAY = 86_400_000;

/** A mod action, the alerts turned on, and the record it would be kept in. */
type RecordCase = Readonly<{ label: string; action: string; enabledActions: readonly string[]; key: string }>;

/** The members of a sorted set, as stored. */
function membersOf(stored: readonly Readonly<{ member: string }>[]): readonly string[] {
    return stored.map(({ member }: Readonly<{ member: string }>): string => member);
}

// A record is moderation metadata, as the mod log shows it: who acted, on whom, when, and for how long.
describe("a ban record", (): void => {
    it("keeps who banned whom, when and for how long, and not the mod note", TEST_OPTIONS, async (): Promise<void> => {
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

        expect(membersOf(await app.context.redis.zRange(BAN_EVENTS_KEY, 0, -1, { by: "rank" }))).toStrictEqual([
            JSON.stringify({ change: "imposed", at: NOW.getTime(), moderatorName: "ModA", details: "7 days" }),
        ]);
    });

    it("carried over from an earlier version leaves its mod note behind", TEST_OPTIONS, async (): Promise<void> => {
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

        await app.fire(
            "ModAction",
            modActionEvent({ action: "unbanuser", moderator: { name: "ModB" }, targetUser: { name: "Troll" } }),
        );

        expect(membersOf(await app.context.redis.zRange(BAN_EVENTS_KEY, 0, -1, { by: "rank" })).join()).not.toContain(
            "Spamming",
        );
    });
});

// Only an unban or unmute alert reads a record, so none is kept while those alerts are off.
describe("a ban or mute record", (): void => {
    it.each<RecordCase>([
        { label: "a ban", action: "banuser", enabledActions: ["banuser", "removelink"], key: BAN_EVENTS_KEY },
        { label: "an unban", action: "unbanuser", enabledActions: ["banuser"], key: BAN_EVENTS_KEY },
        { label: "a mute", action: "muteuser", enabledActions: ["muteuser", "unbanuser"], key: MUTE_EVENTS_KEY },
        { label: "an unmute", action: "unmuteuser", enabledActions: ["muteuser"], key: MUTE_EVENTS_KEY },
    ])(
        "is not kept for $label while alerts for its lifting are off",
        TEST_OPTIONS,
        async ({ action, enabledActions, key }: RecordCase): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { enabledActions });

            await app.fire(
                "ModAction",
                modActionEvent({ action, moderator: { name: "ModA" }, targetUser: { name: "Troll" } }),
            );

            expect(app.context.redis.keys()).not.toContain(key);
        },
    );

    it.each<RecordCase>([
        { label: "a ban", action: "banuser", enabledActions: ["unbanuser"], key: BAN_EVENTS_KEY },
        { label: "a mute", action: "muteuser", enabledActions: ["unmuteuser"], key: MUTE_EVENTS_KEY },
    ])(
        "is kept for $label while alerts for its lifting are on, even with its own alerts off",
        TEST_OPTIONS,
        async ({ action, enabledActions, key }: RecordCase): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { enabledActions });

            await app.fire(
                "ModAction",
                modActionEvent({ action, moderator: { name: "ModA" }, targetUser: { name: "Troll" } }),
            );

            expect(app.context.redis.keys()).toContain(key);
        },
    );
});
