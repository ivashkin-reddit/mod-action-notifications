import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import { CHANNEL } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { ScheduledJob } from "../fixtures/fakeScheduler.js";
import type { SlackField } from "../fixtures/fakeSlack.js";
import { onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
/** From NOW, Wednesday 4 November 12:00 UTC, to Monday 9 November 08:00 UTC. */
const TO_MONDAY_MORNING = (4 * 24 + 20) * 3_600_000;

function digestJobs(jobs: readonly ScheduledJob[]): readonly Readonly<{ name: string; cron: string | undefined }>[] {
    return jobs
        .filter((job: ScheduledJob): boolean => job.name === "weeklyStatistics")
        .map(({ name, cron }: ScheduledJob): Readonly<{ name: string; cron: string | undefined }> => ({ name, cron }));
}

/** The digest's fields with these titles, as title and value, in the digest's order. */
function fieldsTitled(
    fields: readonly SlackField[] | undefined,
    titles: readonly string[],
): readonly (readonly [string, string])[] {
    return (fields ?? [])
        .filter(({ title }: SlackField): boolean => titles.includes(title))
        .map(({ title, value }: SlackField): readonly [string, string] => [title, value]);
}

describe("the weekly statistics job", (): void => {
    it("is scheduled for 08:00 UTC each Monday by setup, once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("AppInstall", { type: "AppInstall" });
        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(digestJobs(app.context.scheduler.jobs)).toStrictEqual([{ name: "weeklyStatistics", cron: "0 8 * * 1" }]);
    });

    it("is off by default: the job sends nothing", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: [] });
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        await app.advance(TO_MONDAY_MORNING);

        await app.runJob("weeklyStatistics");

        expect(app.slack.requests).toStrictEqual([]);
    });

    it(
        "sends the week before's team figures to the notification channel, beside the week before that",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            // No mod action alerts: the actions are only counted.
            const app = await loadApp(devvit, { weeklyStatistics: true, enabledActions: [] });
            await app.fire(
                "ModAction",
                removedPost({ id: "ModAction_0", actionedAt: new Date("2026-10-28T10:00:00Z") }),
            );
            await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
            await app.fire("ModAction", removedPost({ id: "ModAction_2", moderator: { name: "AutoModerator" } }));
            await app.advance(TO_MONDAY_MORNING);

            await app.runJob("weeklyStatistics");

            const message = onlyMessage(app.slack.messages);

            expect([message.channel, message.text]).toStrictEqual([
                CHANNEL,
                "📊 Team statistics, 2026-11-02 to 2026-11-08: 2 actions",
            ]);
            expect(
                fieldsTitled(message.attachments?.[0]?.fields, [
                    "Actions",
                    "Most-moderated threads",
                    "The week before",
                ]),
            ).toStrictEqual([
                ["Actions", "2: 1 by moderators, 1 by AutoModerator, 0 by Reddit"],
                ["Most-moderated threads", "https://www.reddit.com/comments/abc/ (2 removals)"],
                ["The week before", "1 action"],
            ]);
        },
    );

    it("sends once a week, however often the job runs", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { weeklyStatistics: true });
        await app.advance(TO_MONDAY_MORNING);

        await app.runJob("weeklyStatistics");
        await app.runJob("weeklyStatistics");

        expect(app.slack.messages).toHaveLength(1);
    });
});
