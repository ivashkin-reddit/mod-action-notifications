import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { modActionEvent, removedPost } from "../fixtures/events.js";
import type { Settings } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { SlackMessage } from "../fixtures/fakeSlack.js";
import { lines } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const DAY = 86_400_000;
const ALERT_CHANNEL = "C0ALERTS";
/** Only the security alerts: the actions themselves send none. */
const QUIET: Readonly<Settings> = { enabledActions: [], alertChannel: ALERT_CHANNEL };

function daysAgo(days: number): Date {
    return new Date(NOW.getTime() - days * DAY);
}

/** A removal by `moderator`, taken `days` days before NOW. */
function removalBy(moderator: string, id: string, days: number): ReturnType<typeof removedPost> {
    return removedPost({ id, moderator: { name: moderator }, actionedAt: daysAgo(days) });
}

function securityAlerts(messages: readonly SlackMessage[]): readonly SlackMessage[] {
    return messages.filter((message: SlackMessage): boolean => message.text.startsWith("🛡️"));
}

describe("a moderator who acts after a long silence", (): void => {
    it("is sent as a security alert, once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, QUIET);
        await app.fire("ModAction", removalBy("ModA", "ModAction_1", 100));

        await app.fire("ModAction", removalBy("ModA", "ModAction_2", 0));
        await app.fire("ModAction", removalBy("ModA", "ModAction_3", 0));

        const [alert, ...more] = securityAlerts(app.slack.messages);

        expect(more).toStrictEqual([]);
        expect([alert?.channel, alert?.text]).toStrictEqual([
            ALERT_CHANNEL,
            "🛡️ Security alert: u/ModA took their first action in 100 days",
        ]);
        expect(lines(alert)).toStrictEqual([
            "🛡️ *Security Alert*",
            "• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>",
            "• *Last action before:* 2026-07-27 12:00:00 UTC",
            "• *Action:* Post Removed",
        ]);
    });

    it.each([
        ["within the window", { ...QUIET }, 89],
        ["while the window is 0", { ...QUIET, dormantModeratorDays: 0 }, 200],
        ["while Security Alerts is off", { ...QUIET, securityAlerts: false }, 200],
    ])(
        "is not alerted %s",
        TEST_OPTIONS,
        async (_label: string, settings: Readonly<Settings>, days: number): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, settings);
            await app.fire("ModAction", removalBy("ModA", "ModAction_1", days));

            await app.fire("ModAction", removalBy("ModA", "ModAction_2", 0));

            expect(securityAlerts(app.slack.messages)).toStrictEqual([]);
        },
    );

    it("is not alerted the first time the app sees them act", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, QUIET);

        await app.fire("ModAction", removalBy("ModA", "ModAction_1", 0));

        expect(securityAlerts(app.slack.messages)).toStrictEqual([]);
    });

    it("is forgotten once removed from the team", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...QUIET, securityAlerts: false });
        await app.fire("ModAction", removalBy("ModB", "ModAction_1", 200));
        await app.fire(
            "ModAction",
            modActionEvent({
                id: "ModAction_2",
                action: "removemoderator",
                moderator: { name: "ModA" },
                targetUser: { name: "ModB" },
            }),
        );

        await expect(app.context.redis.hGetAll("security:last_action")).resolves.toStrictEqual({
            moda: String(NOW.getTime()),
        });
    });
});

// Stored data: renaming the key would lose what installations hold.
describe("when each moderator last acted", (): void => {
    it("is kept for 400 days, leaving out AutoModerator and Reddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, QUIET);

        await app.fire("ModAction", removalBy("ModA", "ModAction_1", 0));
        await app.fire("ModAction", removalBy("AutoModerator", "ModAction_2", 0));
        await app.fire("ModAction", removalBy("reddit", "ModAction_3", 0));

        await expect(app.context.redis.hGetAll("security:last_action")).resolves.toStrictEqual({
            moda: String(NOW.getTime()),
        });
        expect(app.context.redis.ttlSeconds("security:last_action")).toBe(400 * 86_400);
    });
});
