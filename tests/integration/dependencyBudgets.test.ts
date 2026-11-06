import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import { commentEdited, commentFiltered, commentReported, modmailReceived } from "../fixtures/contentEvents.js";
import { commentDeleteEvent, modActionEvent } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const AREA = "[invocation] ";

/** What an invocation called, as its completion line counts it. */
type Calls = Readonly<{ redis: number; reddit: number; settings: number; slack: number }>;

function calls(line: unknown): Calls | undefined {
    if (typeof line !== "string" || !line.startsWith(AREA)) {
        return undefined;
    }
    const parsed: unknown = JSON.parse(line.slice(AREA.length));
    const fields = new Map<string, unknown>(
        typeof parsed === "object" && parsed !== null ? Object.entries(parsed) : [],
    );
    const count = (dependency: string): number => {
        const tally = fields.get(dependency);
        return typeof tally === "object" && tally !== null && "n" in tally && typeof tally.n === "number"
            ? tally.n
            : -1;
    };
    return { redis: count("redis"), reddit: count("reddit"), settings: count("settings"), slack: count("slack") };
}

/** A handler's budget: its event, the calls it makes exactly, and at most this many Redis calls. */
type Budget = Readonly<{ label: string; type: string; event: unknown; exact: Omit<Calls, "redis">; redis: number }>;

/** Fires the event in an app with Debug Logging on, and returns what its invocation called. */
async function callsOf(app: Readonly<Pick<App, "fire">>, type: string, event: unknown): Promise<Calls | undefined> {
    vi.mocked(console.info).mockClear();
    await app.fire(type, event);
    return vi
        .mocked(console.info)
        .mock.calls.map(([line]: readonly unknown[]): Calls | undefined => calls(line))
        .find((found: Calls | undefined): boolean => found !== undefined);
}

/** ModA removes a comment on t3_p: an alert, quoting the comment and its post's title. */
function commentRemoval(id: string): ReturnType<typeof modActionEvent> {
    return modActionEvent({
        id,
        action: "removecomment",
        moderator: { name: "ModA" },
        targetUser: { name: "Commenter" },
        targetComment: { id: "t1_c", postId: "t3_p", body: "b", permalink: "/r/testsub/comments/p/t/c/" },
    });
}

// The hottest triggers' dependency calls, as measured in the observability pass: a change that adds a settings read,
// a Reddit call or a Redis call in a loop fails here. Settings are read at most once an invocation, as Devvit's client
// fetches every setting on each read; Redis counts are budgets, each the count measured.
describe("an invocation's dependency calls", (): void => {
    it(
        "are, for a comment edit to an item no moderator approved, one Redis read and nothing else",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { debugLogging: true });
            await app.fire("ModAction", commentRemoval("ModAction_warm"));

            await expect(callsOf(app, "CommentUpdate", commentEdited())).resolves.toStrictEqual({
                redis: 1,
                reddit: 0,
                settings: 0,
                slack: 0,
            });
        },
    );

    it.each<Budget>([
        {
            label: "a comment deletion",
            type: "CommentDelete",
            event: commentDeleteEvent({ commentId: "t1_x", postId: "t3_p" }),
            exact: { reddit: 0, settings: 0, slack: 0 },
            redis: 10,
        },
        {
            label: "a comment report",
            type: "CommentReport",
            event: commentReported(),
            exact: { reddit: 0, settings: 1, slack: 0 },
            redis: 4,
        },
        {
            label: "AutoModerator holding a comment",
            type: "AutomoderatorFilterComment",
            event: commentFiltered(),
            exact: { reddit: 0, settings: 0, slack: 0 },
            redis: 3,
        },
        {
            label: "a modmail reply by a moderator",
            type: "ModMail",
            event: modmailReceived({ authorType: "moderator", author: "ModA" }),
            exact: { reddit: 0, settings: 1, slack: 0 },
            redis: 6,
        },
        {
            label: "a mod action alerted, with the mod list known",
            type: "ModAction",
            event: commentRemoval("ModAction_2"),
            exact: { reddit: 0, settings: 1, slack: 1 },
            redis: 70,
        },
    ])(
        "are, for $label, within their budget",
        TEST_OPTIONS,
        async ({ type, event, exact, redis }: Budget): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { debugLogging: true });
            // Warms the mod list, as a running installation has it.
            await app.fire("ModAction", commentRemoval("ModAction_warm"));
            const measured = await callsOf(app, type, event);

            expect(measured).toMatchObject(exact);
            expect(measured?.redis).toBeLessThanOrEqual(redis);
        },
    );
});
