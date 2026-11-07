import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { commentReported, postReported } from "../fixtures/contentEvents.js";
import type { Settings } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lines, onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const ALERT_CHANNEL = "C0ALERTS";
const URGENT = { urgentReportReasons: "personal information, threatening violence", alertChannel: ALERT_CHANNEL };

type UrgentCase = Readonly<{ label: string; settings: Readonly<Settings>; reason: string }>;
type PileUpCase = Readonly<{ label: string; settings: Readonly<Settings>; ignoreReports: boolean }>;

describe("a report with an urgent reason", (): void => {
    it(
        "is sent to the alert channel at once, naming the reason as configured",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, URGENT);

            await app.fire("PostReport", postReported({ reason: "It's sharing PERSONAL INFORMATION", numReports: 2 }));

            const message = onlyMessage(app.slack.messages);

            expect([message.channel, message.text]).toStrictEqual([
                ALERT_CHANNEL,
                "🚨 Urgent report: personal information",
            ]);
            expect(lines(message)).toStrictEqual([
                "🚨 *Urgent Report*",
                "• *Reason:* personal information",
                "• *Content:* <https://www.reddit.com/r/testsub/comments/abc/|View Post>",
                "• *Reports:* 2",
            ]);
        },
    );

    it("never quotes the report's own words, or the content", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, URGENT);

        await app.fire("CommentReport", commentReported({ reason: "u/someone is threatening violence here" }));

        const sent = JSON.stringify(app.slack.requests);

        expect(sent).toContain("threatening violence");
        expect(sent).not.toMatch(/hello_world|someone|what the comment said/u);
        expect(lines(onlyMessage(app.slack.messages))[2]).toBe(
            "• *Content:* <https://www.reddit.com/r/testsub/comments/abc/_/c/|View Comment>",
        );
    });

    it("is sent once a day for each post or comment", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, URGENT);

        await app.fire("PostReport", postReported({ reason: "personal information" }));
        await app.fire("PostReport", postReported({ reason: "threatening violence", numReports: 2 }));

        expect(app.slack.messages).toHaveLength(1);
        expect(app.context.redis.ttlSeconds("reports:urgent:t3_abc")).toBe(86_400);
    });

    it.each<UrgentCase>([
        { label: "no configured reason matches", settings: URGENT, reason: "Spam" },
        {
            label: "no reasons are configured",
            settings: { alertChannel: ALERT_CHANNEL },
            reason: "personal information",
        },
    ])("is not alerted when $label", TEST_OPTIONS, async ({ settings, reason }: UrgentCase): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, settings);

        await app.fire("PostReport", postReported({ reason }));

        expect(app.slack.requests).toStrictEqual([]);
    });
});

describe("reports piling up", (): void => {
    it("are alerted once when a post reaches the threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { reportPileUpThreshold: 3, alertChannel: ALERT_CHANNEL });

        await app.fire("PostReport", postReported({ numReports: 2 }));
        await app.fire("PostReport", postReported({ numReports: 3 }));
        await app.fire("PostReport", postReported({ numReports: 4 }));

        const message = onlyMessage(app.slack.messages);

        expect([message.channel, message.text]).toStrictEqual([ALERT_CHANNEL, "📣 Reports piling up: 3 reports"]);
        expect(lines(message)).toStrictEqual([
            "📣 *Reports Piling Up*",
            "• *Reports:* 3",
            "• *Content:* <https://www.reddit.com/r/testsub/comments/abc/|View Post>",
        ]);
        expect(app.context.redis.ttlSeconds("reports:pileup:t3_abc")).toBe(86_400);
    });

    it.each<PileUpCase>([
        { label: "the threshold is 0", settings: { reportPileUpThreshold: 0 }, ignoreReports: false },
        { label: "moderators ignore the post's reports", settings: { reportPileUpThreshold: 3 }, ignoreReports: true },
    ])("are not alerted when $label", TEST_OPTIONS, async ({ settings, ignoreReports }: PileUpCase): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, settings);

        await app.fire("PostReport", postReported({ numReports: 10, ignoreReports }));

        expect(app.slack.requests).toStrictEqual([]);
    });
});

describe("a report", (): void => {
    it("sends nothing while Slack is not set up", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...URGENT, reportPileUpThreshold: 1, connectedToken: undefined });

        await app.fire("PostReport", postReported({ reason: "personal information", numReports: 5 }));

        expect(app.slack.requests).toStrictEqual([]);
    });
});
