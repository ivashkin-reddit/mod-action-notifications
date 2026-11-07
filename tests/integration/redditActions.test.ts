import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lastLine, lines, onlyMessage } from "../fixtures/messages.js";
import { keysBesidesBookkeeping } from "../fixtures/redisKeys.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
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
                channel: "#mod-log",
            });
            expect([lines(message)[0], lastLine(message)]).toStrictEqual([
                "🔶 *Reddit Action*",
                "• *Status:* Origin Reddit",
            ]);
            expect(app.context.reddit.getModerators).not.toHaveBeenCalled();
        },
    );

    // Reddit's removals count toward its account's activity, so a sweep is summarised as a burst; the spike label
    // stays on moderators' alerts, as Reddit's accounts acting fast is no news.
    it("is counted toward a burst, and its alerts carry no spike label", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        for (let count = 0; count < 5; count += 1) {
            await app.fire(
                "ModAction",
                removedPost({ id: `ModAction_${String(count)}`, moderator: { name: "reddit" } }),
            );
        }

        expect(keysBesidesBookkeeping(app.context.redis)).toStrictEqual([
            "mod_actions:burst:testsub:reddit",
            "mod_actions:moderator_actions:testsub:reddit",
            ...[0, 1, 2, 3, 4].map((count: number): string => `mod_actions:reported:ModAction_${String(count)}`),
        ]);
        expect(lines(app.slack.messages[4]).slice(-2)).toStrictEqual([
            "• *Status:* Origin Reddit",
            "• *Burst:* Further removals by reddit will be summarised",
        ]);
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
