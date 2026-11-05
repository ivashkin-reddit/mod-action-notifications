import { describe, expect, it, vi } from "vitest";
import { loadApp } from "./support/app.js";
import { removedPost } from "./support/events.js";
import type { FakeDevvit } from "./support/fakeDevvit.js";
import { lastLine, lines, onlyMessage } from "./support/messages.js";
import { keysBesidesOutbox } from "./support/redisKeys.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("./support/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

// Reddit's own accounts act in mod logs without being on any mod list: u/reddit for Crowd Control and Reddit's
// filters, Anti-Evil Operations for admin removals. Their actions are told apart from unknown moderators'.
describe("an action by one of Reddit's own accounts", (): void => {
    it.each([["reddit"], ["Anti-Evil Operations"], ["REDDIT"]])(
        "by %s is sent as a Reddit action, not a security alert",
        TEST_OPTIONS,
        async (name): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { alertChannel: "security", notificationChannel: "mod-log" });

            await app.fire("ModAction", removedPost({ moderator: { name } }));

            const message = onlyMessage(app.slack.messages);

            expect(message).toMatchObject({
                text: "🗑️ Post Removed by Reddit",
                icon_emoji: ":shield:",
                channel: "#mod-log",
            });
            expect([lines(message)[0], lastLine(message)]).toStrictEqual([
                "🔶 *Reddit Action*",
                "• *Status:* Origin Reddit",
            ]);
            expect(app.context.reddit.getModerators).not.toHaveBeenCalled();
        },
    );

    it("is not counted toward activity spikes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        for (let count = 0; count < 5; count += 1) {
            await app.fire("ModAction", removedPost({ moderator: { name: "reddit" } }));
        }

        expect(keysBesidesOutbox(app.context.redis)).toStrictEqual([]);
        expect(lastLine(app.slack.messages[4])).toBe("• *Status:* Origin Reddit");
    });

    it("can be silenced by excluding the account", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { excludedModerators: "reddit" });

        await app.fire("ModAction", removedPost({ moderator: { name: "reddit" } }));

        expect(app.slack.requests).toStrictEqual([]);
    });

    it("is sent only for enabled action types", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: ["banuser"] });

        await app.fire("ModAction", removedPost({ moderator: { name: "Anti-Evil Operations" } }));

        expect(app.slack.requests).toStrictEqual([]);
    });
});
