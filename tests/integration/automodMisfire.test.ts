import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import { modActionEvent, removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { SlackMessage } from "../fixtures/fakeSlack.js";
import { lines } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 10_000 };
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** When AutoModerator removed items `perHour` times an hour through the day before NOW. */
function dayBefore(perHour: number): readonly number[] {
    return Array.from(
        { length: 24 * perHour },
        (_unused: unknown, index: number): number => NOW.getTime() - DAY + Math.floor(index / perHour) * HOUR + MINUTE,
    );
}

/** `count` removal times, `minutesAfter` the edit at NOW. */
function afterEdit(count: number, minutesAfter: number): readonly number[] {
    return Array.from({ length: count }, (): number => NOW.getTime() + minutesAfter * MINUTE);
}

/** Fires an AutoModerator removal at each time in turn, as Devvit delivers them, each after the last is handled. */
async function autoModRemovalsAt(app: Readonly<Pick<App, "fire">>, times: readonly number[], index = 0): Promise<void> {
    const at = times[index];
    if (at === undefined) {
        return;
    }
    await app.fire(
        "ModAction",
        removedPost({
            id: `ModAction_${String(at)}_${String(index)}`,
            moderator: { name: "AutoModerator" },
            actionedAt: new Date(at),
        }),
    );
    await autoModRemovalsAt(app, times, index + 1);
}

/** An app where ModA edited AutoModerator's config at NOW, after `perHour` removals an hour the day before. */
async function afterConfigEdit(perHour: number): Promise<App> {
    const app = await loadApp(devvit, { enabledActions: [] });
    app.context.reddit.wikiRevisions = [
        { id: "00000000-0000-4000-8000-000000000002", date: NOW, author: "ModA", reason: "", content: "rule: new\n" },
        {
            id: "00000000-0000-4000-8000-000000000001",
            date: new Date(NOW.getTime() - DAY),
            author: "ModA",
            reason: "",
            content: "rule: old\n",
        },
    ];
    await autoModRemovalsAt(app, dayBefore(perHour));
    await app.fire(
        "ModAction",
        modActionEvent({ id: "ModAction_edit", action: "wikirevise", moderator: { name: "ModA" } }),
    );
    return app;
}

function misfireAlerts(messages: readonly SlackMessage[]): readonly SlackMessage[] {
    return messages.filter((message: SlackMessage): boolean => message.text.startsWith("⚠️ AutoModerator"));
}

/** Removals an hour the day before, and removals after the edit: how many, and how long after. */
type MisfireCase = Readonly<{ label: string; perHour: number; count: number; minutes: number }>;

describe("removals by AutoModerator far above usual after its config is edited", (): void => {
    it("are alerted once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await afterConfigEdit(1);

        await autoModRemovalsAt(app, afterEdit(20, 30));
        await autoModRemovalsAt(app, afterEdit(5, 40));

        const [alert, ...more] = misfireAlerts(app.slack.messages);

        expect(more).toStrictEqual([]);
        expect(alert?.text).toBe("⚠️ AutoModerator removed 20 items in the hour after u/ModA edited its config");
        expect(lines(alert)).toStrictEqual([
            "⚠️ *AutoModerator may be misfiring*",
            "• *Since the edit:* 20 removals",
            "• *The day before:* 1 an hour on average",
            "• *History:* <https://www.reddit.com/r/testsub/wiki/revisions/config/automoderator|View the config's revisions>",
        ]);
    });

    it.each<MisfireCase>([
        { label: "fewer than 20", perHour: 1, count: 19, minutes: 30 },
        { label: "fewer than five times the day before's average", perHour: 5, count: 24, minutes: 30 },
        { label: "more than an hour after the edit", perHour: 1, count: 30, minutes: 61 },
    ])("are not alerted when $label", TEST_OPTIONS, async ({ perHour, count, minutes }: MisfireCase): Promise<void> => {
        expect.hasAssertions();

        const app = await afterConfigEdit(perHour);

        await autoModRemovalsAt(app, afterEdit(count, minutes));

        expect(misfireAlerts(app.slack.messages)).toStrictEqual([]);
    });

    // A day of removal counts is read only while a misfire could be found: in the hour after an edit.
    it("reads no removal counts once the hour after the edit is over", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await afterConfigEdit(1);
        app.context.redis.hGetAll.mockClear();

        await autoModRemovalsAt(app, afterEdit(1, 61));

        expect(
            app.context.redis.hGetAll.mock.calls.filter(([key]: readonly [string]): boolean =>
                key.startsWith("security:automod_removals:"),
            ),
        ).toStrictEqual([]);
    });
});
