import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { modActionEvent } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { SlackMessage } from "../fixtures/fakeSlack.js";
import type { FakeWikiRevision } from "../fixtures/fakeWiki.js";
import { lines } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const DAY = 86_400_000;
const ALERT_CHANNEL = "C0ALERTS";

/** ModA's edit of AutoModerator's config, at NOW, after ModB's five days before. */
const REVISIONS: readonly FakeWikiRevision[] = [
    {
        id: "00000000-0000-4000-8000-000000000002",
        date: NOW,
        author: "ModA",
        reason: "tighten the link rule",
        content: "rule: a\nrule: secret-regex-b\nrule: c\n",
    },
    {
        id: "00000000-0000-4000-8000-000000000001",
        date: new Date(NOW.getTime() - 5 * DAY),
        author: "ModB",
        reason: "",
        content: "rule: a\nrule: x\n",
    },
];

const wikiEdit = modActionEvent({ id: "ModAction_1", action: "wikirevise", moderator: { name: "ModA" } });

function securityAlerts(messages: readonly SlackMessage[]): readonly SlackMessage[] {
    return messages.filter((message: SlackMessage): boolean => message.text.startsWith("🛡️"));
}

describe("an edit to AutoModerator's config", (): void => {
    it("is sent as a security alert, without the config's text", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: [], alertChannel: ALERT_CHANNEL });
        app.context.reddit.wikiRevisions = REVISIONS;

        await app.fire("ModAction", wikiEdit);

        const [alert, ...more] = securityAlerts(app.slack.messages);

        expect(more).toStrictEqual([]);
        expect([alert?.channel, alert?.text]).toStrictEqual([
            ALERT_CHANNEL,
            "🛡️ Security alert: AutoModerator's config was edited by u/ModA",
        ]);
        expect(lines(alert)).toStrictEqual([
            "🛡️ *Security Alert*",
            "• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>",
            "• *Reason:* tighten the link rule",
            "• *Changes:* 2 lines added, 1 removed",
            "• *History:* <https://www.reddit.com/r/testsub/wiki/revisions/config/automoderator|View the config's revisions>",
        ]);
        expect(JSON.stringify(app.slack.requests)).not.toContain("secret-regex");
    });

    it("is noted for the misfire check, for a day", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: [] });
        app.context.reddit.wikiRevisions = REVISIONS;

        await app.fire("ModAction", wikiEdit);

        await expect(app.context.redis.get("security:automod_edit")).resolves.toBe(
            JSON.stringify({ at: NOW.getTime(), by: "ModA" }),
        );
        expect(app.context.redis.ttlSeconds("security:automod_edit")).toBe(86_400);
    });
});

describe("a wiki edit", (): void => {
    it(
        "is not alerted when the config's latest revision is not the moderator's",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { enabledActions: [] });
            app.context.reddit.wikiRevisions = REVISIONS.slice(1);

            await app.fire("ModAction", wikiEdit);

            expect(securityAlerts(app.slack.messages)).toStrictEqual([]);
        },
    );

    it("is not checked while Security Alerts is off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: [], securityAlerts: false });
        app.context.reddit.wikiRevisions = REVISIONS;

        await app.fire("ModAction", wikiEdit);

        expect(securityAlerts(app.slack.messages)).toStrictEqual([]);
        expect(app.context.reddit.getWikiPageRevisions).not.toHaveBeenCalled();
    });

    it(
        "is logged, and not alerted, when the config's revisions cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { enabledActions: [] });
            const failure = new Error("wiki unavailable");
            app.context.reddit.getWikiPage.mockRejectedValueOnce(failure);
            app.context.reddit.wikiRevisions = REVISIONS;

            await app.fire("ModAction", wikiEdit);

            expect(securityAlerts(app.slack.messages)).toStrictEqual([]);
            expect(console.warn).toHaveBeenCalledWith(
                "[security] Could not read AutoModerator's config, so a wiki edit was not checked:",
                failure,
            );
        },
    );
});
