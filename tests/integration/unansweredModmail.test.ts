import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { CHANNEL } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { FakeConversation, ModmailFolder } from "../fixtures/fakeModmail.js";
import { monitorJobs } from "../fixtures/jobs.js";
import { lines, onlyMessage } from "../fixtures/messages.js";
import { queuedPost } from "../fixtures/queue.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const MS_PER_HOUR = 3_600_000;
/** Every modqueue alert off, and modmail waiting 6 hours alerting. */
const MODMAIL_ONLY = { modqueueThreshold: 0, unmoderagedAgeHours: 0, reportedContentAgeHours: 0, modmailWaitHours: 6 };
const FOLDERS =
    "• *Modmail:* <https://mod.reddit.com/mail/new|New> · <https://mod.reddit.com/mail/inprogress|In Progress> · <https://mod.reddit.com/mail/appeals|Appeals>";

function hoursAgo(hours: number): Date {
    return new Date(NOW.getTime() - hours * MS_PER_HOUR);
}

type Waits = Readonly<{ userHours: number; modHours?: number; isAuto?: boolean; state?: string }>;

/** A conversation whose user last wrote `userHours` before NOW, and its moderators `modHours` before, if ever. */
function conversation(
    id: string,
    folder: ModmailFolder,
    { userHours, modHours, isAuto, state }: Waits,
): FakeConversation {
    return {
        id,
        subject: `Subject ${id}`,
        folder,
        lastUserUpdate: hoursAgo(userHours),
        ...(modHours === undefined ? {} : { lastModUpdate: hoursAgo(modHours) }),
        ...(isAuto === undefined ? {} : { isAuto }),
        ...(state === undefined ? {} : { state }),
        messages: [{ id: `${id}-m`, author: "SomeUser" }],
    };
}

describe("modmail waiting for a reply", (): void => {
    it(
        "is alerted when a user has waited the configured hours since they last wrote, counting ban appeals apart",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, MODMAIL_ONLY);
            app.context.reddit.conversations = [
                conversation("c1", "new", { userHours: 30 }),
                conversation("c2", "inprogress", { userHours: 10, modHours: 12 }),
                conversation("c3", "appeals", { userHours: 8 }),
                conversation("c4", "inprogress", { userHours: 2 }),
                conversation("c5", "inprogress", { userHours: 20, modHours: 1 }),
                conversation("c6", "new", { userHours: 50, isAuto: true }),
                conversation("c7", "archived", { userHours: 40 }),
                conversation("c8", "appeals", { userHours: 40, state: "Archived" }),
            ];

            await app.runJob("modqueueMonitor");

            const message = onlyMessage(app.slack.messages);

            expect([message.channel, message.text]).toStrictEqual([
                CHANNEL,
                "📬 Modmail waiting for a reply: 3 conversations",
            ]);
            expect(lines(message)).toStrictEqual([
                "📬 *Modmail Waiting*",
                "• *Waiting for a reply:* 3, of them 1 ban appeal",
                "• *Longest wait:* 30 hours since the user last wrote",
                FOLDERS,
            ]);
            expect(app.context.reddit.modMail.getConversations.mock.calls).toStrictEqual([
                [{ subreddits: ["testsub"], state: "new", limit: 100 }],
                [{ subreddits: ["testsub"], state: "inprogress", limit: 100 }],
                [{ subreddits: ["testsub"], state: "appeals", limit: 100 }],
            ]);
        },
    );

    it("is alerted at most every six hours", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, MODMAIL_ONLY);
        app.context.reddit.conversations = [conversation("c1", "new", { userHours: 7 })];

        await app.runJob("modqueueMonitor");
        await app.runJob("modqueueMonitor");

        expect(lines(onlyMessage(app.slack.messages)).slice(1, 3)).toStrictEqual([
            "• *Waiting for a reply:* 1",
            "• *Longest wait:* 7 hours since the user last wrote",
        ]);
        expect(app.context.redis.ttlSeconds("modmail:throttle:waiting")).toBe(21_600);
    });

    it("says there may be more when a folder holds more than the app reads", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, MODMAIL_ONLY);
        app.context.reddit.conversations = Array.from(
            { length: 101 },
            (_unused: unknown, index: number): FakeConversation =>
                conversation(`c${String(index)}`, "new", { userHours: 7 }),
        );

        await app.runJob("modqueueMonitor");

        const message = onlyMessage(app.slack.messages);

        expect(message.text).toBe("📬 Modmail waiting for a reply: at least 100 conversations");
        expect(lines(message).slice(1, 3)).toStrictEqual([
            "• *Waiting for a reply:* at least 100",
            "• *Longest wait:* at least 7 hours since the user last wrote",
        ]);
    });

    it("is not alerted when every user has had a reply, or wrote lately", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, MODMAIL_ONLY);
        app.context.reddit.conversations = [
            conversation("c1", "inprogress", { userHours: 20, modHours: 1 }),
            conversation("c2", "new", { userHours: 5 }),
        ];

        await app.runJob("modqueueMonitor");

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.redis.dump("modmail:throttle:waiting")).toBeUndefined();
    });

    it("is on by default, at 24 hours", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0, reportedContentAgeHours: 0 });
        app.context.reddit.conversations = [
            conversation("c1", "new", { userHours: 23 }),
            conversation("c2", "new", { userHours: 25 }),
        ];

        await app.runJob("modqueueMonitor");

        expect(lines(onlyMessage(app.slack.messages)).slice(1, 3)).toStrictEqual([
            "• *Waiting for a reply:* 1",
            "• *Longest wait:* 25 hours since the user last wrote",
        ]);
    });

    it("reads no modmail while the setting is 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...MODMAIL_ONLY, modqueueThreshold: 1, modmailWaitHours: 0 });
        app.context.reddit.conversations = [conversation("c1", "new", { userHours: 30 })];

        await app.runJob("modqueueMonitor");

        expect(app.context.reddit.modMail.getConversations).not.toHaveBeenCalled();
    });

    it("keeps the monitor scheduled while only it is on", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, MODMAIL_ONLY);

        await app.fire("AppInstall", { type: "AppInstall" });

        expect(monitorJobs(app.context.scheduler.jobs)).toStrictEqual([
            { id: "job-1", name: "modqueueMonitor", cron: "*/15 * * * *" },
        ]);
    });
});

describe("modmail the monitor cannot read", (): void => {
    it(
        "is logged once as a problem, and leaves the modqueue alerts and the monitor's health alone",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { ...MODMAIL_ONLY, modqueueThreshold: 1 });
            app.context.reddit.modQueue = [queuedPost("a", 1)];
            app.context.reddit.modMail.getConversations.mockRejectedValue(new Error("modmail is down"));

            await app.runJob("modqueueMonitor");
            await app.runJob("modqueueMonitor");

            expect(vi.mocked(console.error).mock.calls).toStrictEqual([
                [
                    "[health] The app cannot read modmail (modmail is down), so modmail from Reddit's admins and modmail waiting for a reply are not alerted.",
                ],
            ]);
            expect(app.slack.messages.map((message): string | undefined => message.text)).toStrictEqual([
                "⚠️ Modqueue Alert: 1 items pending",
            ]);
        },
    );
});
