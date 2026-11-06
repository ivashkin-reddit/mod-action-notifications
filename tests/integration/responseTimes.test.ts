import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { commentFiltered, modmailReceived, postReported } from "../fixtures/contentEvents.js";
import { modActionEvent, removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { MINUTE, onlyMessage } from "../fixtures/messages.js";
import { RESPONSE_LINES, responseLines } from "../fixtures/teamStats.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** A hash's fields, as the fake Redis dumps one; none for anything else. */
function fieldsOf(dumped: unknown): Readonly<Record<string, unknown>> {
    return typeof dumped === "object" && dumped !== null && "fields" in dumped && typeof dumped.fields === "object"
        ? { ...dumped.fields }
        : {};
}

/** `moderator` approves Author's post t3_abc. */
function approvedPost(id: string, moderator: string): ReturnType<typeof modActionEvent> {
    return modActionEvent({
        id,
        action: "approvelink",
        moderator: { name: moderator },
        targetUser: { name: "Author" },
        targetPost: { id: "t3_abc", permalink: "/r/testsub/comments/abc/hello_world/", authorId: "t2_author" },
    });
}

/** `moderator` removes Commenter's comment t1_c. */
function removedComment(id: string, moderator: string): ReturnType<typeof modActionEvent> {
    return modActionEvent({
        id,
        action: "removecomment",
        moderator: { name: moderator },
        targetUser: { name: "Commenter" },
        targetComment: {
            id: "t1_c",
            postId: "t3_abc",
            permalink: "/r/testsub/comments/abc/hello_world/c/",
            author: "Commenter",
        },
    });
}

/** `moderator` approves Commenter's comment t1_c. */
function approvedComment(id: string, moderator: string): ReturnType<typeof modActionEvent> {
    return modActionEvent({
        id,
        action: "approvecomment",
        moderator: { name: moderator },
        targetUser: { name: "Commenter" },
        targetComment: {
            id: "t1_c",
            postId: "t3_abc",
            permalink: "/r/testsub/comments/abc/hello_world/c/",
            author: "Commenter",
        },
    });
}

describe("the time the team takes to act on the queue", (): void => {
    it(
        "runs from a report to a moderator's removal, and counts the reported item's outcome",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            await app.fire("PostReport", postReported());
            await app.advance(30 * MINUTE);

            await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

            await expect(responseLines(app)).resolves.toStrictEqual({
                "Time to act on the queue": "median within an hour, of 1 item handled",
                "Reported items": "1 removed (100%), 0 approved (0%)",
                "Filtered by AutoModerator": "none",
                "Removals reversed": "0 of Reddit's, 0 of another moderator's",
                "Modmail replies": "none",
            });
        },
    );

    it(
        "runs from AutoModerator's filter to a moderator's approval, its false positive",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            await app.fire("AutomoderatorFilterComment", commentFiltered());
            await app.advance(10 * MINUTE);

            await app.fire("ModAction", approvedComment("ModAction_1", "ModA"));

            await expect(responseLines(app)).resolves.toMatchObject({
                "Time to act on the queue": "median within 15 minutes, of 1 item handled",
                "Reported items": "none",
                "Filtered by AutoModerator": "0 removed (0%), 1 approved (100%)",
            });
        },
    );

    it("starts at the first report, however many follow", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("PostReport", postReported());
        await app.advance(2 * HOUR);
        await app.fire("PostReport", postReported({ numReports: 2 }));
        await app.advance(HOUR);

        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));

        await expect(responseLines(app)).resolves.toMatchObject({
            "Time to act on the queue": "median within 4 hours, of 1 item handled",
        });
    });

    it("counts an item once when two moderators act on it at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("PostReport", postReported());
        // Devvit can run the handlers for both at once.
        await Promise.all([
            app.fire("ModAction", removedPost({ id: "ModAction_1" })),
            app.fire("ModAction", removedPost({ id: "ModAction_2", moderator: { name: "ModB" } })),
        ]);

        await expect(responseLines(app)).resolves.toMatchObject({
            "Time to act on the queue": "median within 15 minutes, of 1 item handled",
            "Reported items": "1 removed (100%), 0 approved (0%)",
        });
    });

    // AutoModerator's filter is itself logged as its removal, in either order with the filter event; Reddit's
    // filters remove reported items too. The item waits on for a moderator.
    it(
        "leaves an item waiting for a moderator whatever AutoModerator or Reddit does to it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            await app.fire("AutomoderatorFilterComment", commentFiltered());
            await app.fire("ModAction", removedComment("ModAction_1", "AutoModerator"));
            await app.fire("PostReport", postReported());
            await app.fire("ModAction", removedPost({ id: "ModAction_2", moderator: { name: "reddit" } }));
            await app.fire("ModAction", approvedComment("ModAction_3", "ModA"));
            await app.fire("ModAction", approvedPost("ModAction_4", "ModA"));

            await expect(responseLines(app)).resolves.toMatchObject({
                "Time to act on the queue": "median within 15 minutes, of 2 items handled",
                "Reported items": "0 removed (0%), 1 approved (100%)",
                "Filtered by AutoModerator": "0 removed (0%), 1 approved (100%)",
            });
        },
    );
});

describe("the weekly digest", (): void => {
    it("carries how the team responded", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { weeklyStatistics: true, enabledActions: [] });
        await app.fire("PostReport", postReported());
        await app.advance(30 * MINUTE);
        await app.fire("ModAction", removedPost({ id: "ModAction_1" }));
        // From Wednesday 4 November 12:30 UTC to Monday 9 November 08:00 UTC.
        await app.advance(4 * DAY + 19 * HOUR + 30 * MINUTE);

        await app.runJob("weeklyStatistics");

        expect(
            (onlyMessage(app.slack.messages).attachments?.[0]?.fields ?? [])
                .filter(({ title }): boolean => RESPONSE_LINES.includes(title))
                .map(({ title, value }): readonly [string, string] => [title, value]),
        ).toStrictEqual([
            ["Time to act on the queue", "median within an hour, of 1 item handled"],
            ["Reported items", "1 removed (100%), 0 approved (0%)"],
            ["Filtered by AutoModerator", "none"],
            ["Removals reversed", "0 of Reddit's, 0 of another moderator's"],
            ["Modmail replies", "none"],
        ]);
    });
});

describe("removals reversed", (): void => {
    it(
        "count a moderator approving what Reddit removed, or what another moderator removed",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            await app.fire("ModAction", removedPost({ id: "ModAction_1", moderator: { name: "reddit" } }));
            await app.fire("ModAction", approvedPost("ModAction_2", "ModA"));
            await app.fire("ModAction", removedPost({ id: "ModAction_3", moderator: { name: "ModA" } }));
            await app.fire("ModAction", approvedPost("ModAction_4", "ModB"));
            await app.fire("ModAction", removedPost({ id: "ModAction_5", moderator: { name: "ModB" } }));
            await app.fire("ModAction", approvedPost("ModAction_6", "ModB"));

            await expect(responseLines(app)).resolves.toMatchObject({
                "Removals reversed": "1 of Reddit's, 1 of another moderator's",
            });
        },
    );

    it("are forgotten after a day", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("ModAction", removedPost({ id: "ModAction_1", moderator: { name: "reddit" } }));
        await app.advance(2 * DAY);

        await app.fire("ModAction", approvedPost("ModAction_2", "ModA"));

        await expect(responseLines(app)).resolves.toMatchObject({
            "Removals reversed": "0 of Reddit's, 0 of another moderator's",
        });
    });
});

describe("what response times keep", (): void => {
    it("holds no username", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("PostReport", postReported());
        await app.fire("ModMail", modmailReceived({ author: "SomeUser" }));
        await app.fire("ModAction", removedPost({ id: "ModAction_1", moderator: { name: "ModB" } }));
        await app.fire("AutomoderatorFilterComment", commentFiltered());

        const stored = app.context.redis
            .keys()
            .filter((key: string): boolean => key.startsWith("stats:"))
            .map((key: string): string => `${key} ${JSON.stringify(app.context.redis.dump(key))}`);

        expect(stored.join("\n")).not.toMatch(/Author|Commenter|Matched|ModB|SomeUser/u);
        expect(stored.some((entry: string): boolean => entry.startsWith("stats:awaiting "))).toBe(true);
    });

    it("forgets what has waited over a week, when the weekly job runs", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        await app.fire("PostReport", postReported());
        await app.fire("ModMail", modmailReceived({ author: "SomeUser", conversationId: "ModmailConversation_c1" }));
        await app.advance(7 * DAY + HOUR);
        await app.fire("AutomoderatorFilterComment", commentFiltered());
        await app.fire(
            "ModMail",
            modmailReceived({
                author: "SomeUser",
                conversationId: "ModmailConversation_c2",
                messageId: "ModmailMessage_m2",
            }),
        );

        await app.runJob("weeklyStatistics");

        expect([
            Object.keys(fieldsOf(app.context.redis.dump("stats:awaiting"))),
            Object.keys(fieldsOf(app.context.redis.dump("stats:modmail_waiting"))),
        ]).toStrictEqual([["t1_c"], ["c2"]]);
    });
});
