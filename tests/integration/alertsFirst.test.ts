import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { modmailReceived } from "../fixtures/contentEvents.js";
import { removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 10_000 };
const ALERT_CHANNEL = "C0ALERTS";
const NOTIFICATION_CHANNEL = "C0NOTIFY";
const LEASE_KEY = "slack_outbox_lease";
/** Another drain's lease, which ends after the events below, before the scheduled drain runs. */
const LEASE_MS = 60_000;
const BACKLOG = 100;

describe("an alert for the Alert Channel", (): void => {
    it(
        "is delivered before the routine alerts that were waiting ahead of it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, {
                alertChannel: ALERT_CHANNEL,
                notificationChannel: NOTIFICATION_CHANNEL,
                flagUnknownModerators: false,
            });
            app.context.reddit.conversations = [
                {
                    id: "c1",
                    subject: "About your community's rules",
                    folder: "inprogress",
                    messages: [
                        { id: "m0", author: "SomeUser" },
                        { id: "m1", author: "Admin", isAdmin: true },
                    ],
                },
            ];
            // Another drain holds the queue, so each alert waits in it, as in a burst.
            await app.context.redis.set(LEASE_KEY, "another drain", {
                expiration: new Date(NOW.getTime() + LEASE_MS),
            });
            for (let index = 0; index < BACKLOG; index += 1) {
                await app.fire("ModAction", removedPost({ id: `ModAction_${String(index)}` }));
            }
            await app.fire("ModMail", modmailReceived());
            await app.advance(LEASE_MS);

            await app.runJob("slackOutbox");

            const [first, second] = app.slack.messages;

            expect([first?.channel, first?.text]).toStrictEqual([
                ALERT_CHANNEL,
                "🛡️ Modmail from a Reddit admin: u/Admin",
            ]);
            expect(second?.channel).toBe(NOTIFICATION_CHANNEL);
        },
    );
});
