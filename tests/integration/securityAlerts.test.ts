import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { modActionEvent } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lines, onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const ALERT_CHANNEL = "C0ALERTS";

/** ModA takes the action on ModB. */
function teamChange(action: string): ReturnType<typeof modActionEvent> {
    return modActionEvent({ action, moderator: { name: "ModA" }, targetUser: { name: "ModB" } });
}

// Changing who moderates, or which apps act here, is what a compromised moderator account would do first.
describe("a change to the mod team or its apps", (): void => {
    it.each([
        ["setpermissions", "🔑 Moderator Permissions Changed"],
        ["addmoderator", "👤 Moderator Added"],
        ["removemoderator", "👤 Moderator Removed"],
        ["dev_platform_app_installed", "🧩 App Installed"],
    ])(
        "is sent as a security alert to the alert channel: %s",
        TEST_OPTIONS,
        async (action: string, title: string): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { alertChannel: ALERT_CHANNEL });

            await app.fire("ModAction", teamChange(action));

            const message = onlyMessage(app.slack.messages);

            expect([message.channel, message.text, lines(message)[0]]).toStrictEqual([
                ALERT_CHANNEL,
                `🛡️ Security alert: ${title}`,
                "🛡️ *Security Alert*",
            ]);
        },
    );

    it("is sent whatever Enabled Mod Actions and Excluded Moderators say", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: ["removelink"], excludedModerators: "ModA" });

        await app.fire("ModAction", teamChange("setpermissions"));

        expect(app.slack.messages).toHaveLength(1);
    });

    it("follows Enabled Mod Actions while Security Alerts is off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { securityAlerts: false, enabledActions: ["addmoderator"] });

        await app.fire("ModAction", teamChange("setpermissions"));
        await app.fire("ModAction", teamChange("addmoderator"));

        expect(app.slack.messages.map(({ text }): string => text)).toStrictEqual(["👤 Moderator Added"]);
    });
});
