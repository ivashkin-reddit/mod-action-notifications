import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { modActionEvent } from "../fixtures/events.js";
import { BOT_TOKEN, CHANNEL } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { WORKSPACE } from "../fixtures/fakeSlack.js";
import type { SlackRequest } from "../fixtures/fakeSlack.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
/** The bot token of the Slack app a subreddit's moderators made in their own workspace. */
const TOKEN = "xoxb-their-workspace";
const ALERT_CHANNEL = "C0456ALERT";
// Stored data: renaming the key would disconnect every installation.
const CONNECTION_KEY = "slack_connection";
/** Slack failing every attempt one drain makes at a call, so it waits for a later drain. */
const SLACK_DOWN = [503, 503, 503, 503] as const;
const removal = modActionEvent({ action: "removelink", moderator: { name: "ModA" } });

/** Each call's Web API method, and the token it was made with. */
function callsIn(requests: readonly SlackRequest[]): readonly (readonly [string, unknown])[] {
    return requests.map(({ api, headers }: SlackRequest): readonly [string, unknown] => [
        api,
        typeof headers === "object" && headers !== null
            ? new Map(Object.entries(headers)).get("authorization")
            : undefined,
    ]);
}

describe("the Connect Slack menu item", (): void => {
    it("asks for the bot token of the Slack app made from the manifest", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { connectedToken: undefined });

        await app.pressMenuItem("Connect Slack");

        const { definition } = app.shownForm();

        expect(definition.title).toBe("Connect Slack");
        expect(definition.acceptLabel).toBe("Connect");
        expect(definition.fields.map((field): string => field.name)).toStrictEqual(["token"]);
    });

    it(
        "checks the token with Slack, posts to each alert channel, then sends alerts with it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { connectedToken: undefined, alertChannel: ALERT_CHANNEL });

            await app.fillForm("Connect Slack", { token: `  ${TOKEN}  ` });
            await app.fire("ModAction", removal);

            expect(callsIn(app.slack.requests)).toStrictEqual([
                ["auth.test", `Bearer ${TOKEN}`],
                ["chat.postMessage", `Bearer ${TOKEN}`],
                ["chat.postMessage", `Bearer ${TOKEN}`],
                ["chat.postMessage", `Bearer ${TOKEN}`],
            ]);
            expect(app.slack.messages.slice(0, 2)).toStrictEqual([
                { channel: CHANNEL, text: "🔗 Connected: r/testsub's alerts come to this channel." },
                { channel: ALERT_CHANNEL, text: "🔗 Connected: r/testsub's alerts come to this channel." },
            ]);
            expect(app.toasts).toStrictEqual([
                {
                    text: `✅ Connected to ${WORKSPACE}. A message from the app is in each alert channel.`,
                    appearance: "success",
                },
            ]);
        },
    );

    it("keeps the token and the workspace's name, and nothing else", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { connectedToken: undefined });

        await app.fillForm("Connect Slack", { token: TOKEN });

        expect(JSON.parse((await app.context.redis.get(CONNECTION_KEY)) ?? "")).toStrictEqual({
            token: TOKEN,
            team: WORKSPACE,
        });
        expect(app.context.redis.ttlSeconds(CONNECTION_KEY)).toBeUndefined();
    });

    // No drain delivers while Slack is not connected, and none follows of itself once it is.
    it("has the alerts queued while it was not connected delivered", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        app.slack.respond(...SLACK_DOWN);
        await app.fire("ModAction", removal);
        await app.fillForm("Connect Slack", { token: "" });
        // The drain the failure scheduled runs, and delivers nothing.
        await app.runJob("slackOutbox");
        const scheduled = app.context.scheduler.runJob.mock.calls.length;

        await app.fillForm("Connect Slack", { token: TOKEN });

        expect(app.context.scheduler.runJob.mock.calls.slice(scheduled)).toStrictEqual([
            [expect.objectContaining({ name: "slackOutbox" })],
        ]);

        await app.runJob("slackOutbox");

        expect(callsIn(app.slack.requests).slice(-1)).toStrictEqual([["chat.postMessage", `Bearer ${TOKEN}`]]);
        expect(app.slack.messages.map(({ text }): boolean => text.startsWith("🔗"))).toStrictEqual([
            false,
            false,
            false,
            false,
            true,
            false,
        ]);
    });

    it("replaces the token connected before", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fillForm("Connect Slack", { token: TOKEN });
        await app.fire("ModAction", removal);

        expect(callsIn(app.slack.requests).slice(-1)).toStrictEqual([["chat.postMessage", `Bearer ${TOKEN}`]]);
    });
});

describe("connecting Slack", (): void => {
    it("refuses what is not a bot token, without asking Slack", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fillForm("Connect Slack", { token: "xoxp-a-user-token" });

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.toasts).toStrictEqual([
            {
                text: "❌ That isn't a bot token. Copy the Bot User OAuth Token, which starts xoxb-, from your Slack app's OAuth & Permissions page.",
                appearance: "neutral",
            },
        ]);
    });

    it(
        "refuses a token Slack does not take, and keeps the connection there was",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.slack.respond("invalid_auth");

            await app.fillForm("Connect Slack", { token: TOKEN });
            await app.fire("ModAction", removal);

            expect(callsIn(app.slack.requests)).toStrictEqual([
                ["auth.test", `Bearer ${TOKEN}`],
                ["chat.postMessage", `Bearer ${BOT_TOKEN}`],
            ]);
            expect(app.toasts).toStrictEqual([
                {
                    text: "❌ Slack didn't take that token (invalid_auth). Copy the Bot User OAuth Token from your Slack app's OAuth & Permissions page.",
                    appearance: "neutral",
                },
            ]);
            expect(console.warn).toHaveBeenCalledWith("[menu] Slack didn't take the token to connect: invalid_auth");
        },
    );

    it(
        "refuses a token Slack won't post with to an alert channel, and connects nothing",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { connectedToken: undefined });
            app.slack.respond(200, "not_in_channel");

            await app.fillForm("Connect Slack", { token: TOKEN });

            expect(app.toasts).toStrictEqual([
                {
                    text: `❌ Slack didn't post to ${CHANNEL} (not_in_channel). Add the Slack app to the channel, then connect again.`,
                    appearance: "neutral",
                },
            ]);
            expect(app.context.redis.keys()).not.toContain(CONNECTION_KEY);
        },
    );

    it("asks for the Notification Channel first", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { connectedToken: undefined, notificationChannel: "" });

        await app.fillForm("Connect Slack", { token: TOKEN });

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.toasts).toStrictEqual([
            {
                text: "⚠️ Set the Notification Channel in the app's settings, add the Slack app to it, then connect.",
                appearance: "neutral",
            },
        ]);
    });

    it("disconnects when no token is given", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fillForm("Connect Slack", { token: "  " });
        await app.fire("ModAction", removal);

        expect(app.slack.requests).toStrictEqual([]);
        expect(app.context.redis.keys()).not.toContain(CONNECTION_KEY);
        expect(app.toasts).toStrictEqual([
            {
                text: "Slack is disconnected: no alerts are sent until it is connected again.",
                appearance: "neutral",
            },
        ]);
    });

    it("never logs the token", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { connectedToken: undefined });
        app.slack.respond("invalid_auth");

        await app.fillForm("Connect Slack", { token: TOKEN });

        expect(JSON.stringify([vi.mocked(console.warn).mock.calls, vi.mocked(console.error).mock.calls])).not.toContain(
            TOKEN,
        );
    });
});

describe("show Bot Status", (): void => {
    it("names the Slack workspace connected", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { connectedToken: undefined });
        await app.fillForm("Connect Slack", { token: TOKEN });

        await app.pressMenuItem("Show Bot Status");

        expect(
            app.shownForm().definition.fields.find((field): boolean => field.label === "Slack app")?.defaultValue,
        ).toBe(`Connected to ${WORKSPACE}`);
    });
});
