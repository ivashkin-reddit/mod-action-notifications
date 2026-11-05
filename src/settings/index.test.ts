import { describe, expect, it } from "vitest";
import { createFakeContext, defaultSettings, WEBHOOK_URL } from "../../tests/fixtures/fakeContext.js";
import type { Settings } from "../../tests/fixtures/fakeContext.js";
import { createConfigLoader } from "./index.js";
import type { AppConfig } from "./index.js";

const TEST_OPTIONS = { timeout: 1000 };

/** The configuration read from these settings. */
async function configFrom(settings: Readonly<Settings>): Promise<AppConfig> {
    return await createConfigLoader()(createFakeContext(settings).context.settings, "t5_one");
}

describe("reading the settings", (): void => {
    it("gives the defaults for settings never saved", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        await expect(configFrom({})).resolves.toStrictEqual({
            slackWebhookUrl: "",
            enabledActions: [],
            excludedModerators: [],
            flagUnknownModerators: true,
            includeModNote: true,
            notificationChannel: "",
            alertChannel: "",
            modqueueThreshold: 50,
            unmoderatedAgeHours: 24,
            reportedContentAgeHours: 24,
            enableAutoModAlerts: false,
            postDeletionUpvoteThreshold: 100,
        });
    });

    it.each([
        ["a whole number", 12, 12],
        ["a fraction, rounded down", 12.9, 12],
        ["a negative number, as 0", -3, 0],
        ["numeric text", "7", 7],
        ["negative numeric text, as 0", "-3", 0],
        ["numeric text with spaces and a fraction", " 7.9 ", 7],
        ["text that is no number, as the default", "lots", 50],
        ["blank text, as the default", "", 50],
        ["a value of another type, as the default", true, 50],
    ])(
        "reads a threshold given as %s",
        TEST_OPTIONS,
        async (_label: string, value: unknown, threshold: number): Promise<void> => {
            expect.hasAssertions();

            await expect(configFrom({ modqueueThreshold: value })).resolves.toMatchObject({
                modqueueThreshold: threshold,
            });
        },
    );

    it.each([
        ["a name with spaces and a #", " #mod-log ", "mod-log"],
        ["a name with several #s", "##mod-log", "mod-log"],
        ["a value of another type, as none", 5, ""],
    ])(
        "reads a channel given as %s",
        TEST_OPTIONS,
        async (_label: string, value: unknown, channel: string): Promise<void> => {
            expect.hasAssertions();

            await expect(configFrom({ notificationChannel: value })).resolves.toMatchObject({
                notificationChannel: channel,
            });
        },
    );

    // The Alert Channel setting's help text: "uses main channel if empty".
    it(
        "sends alerts to the notification channel when no alert channel is set",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            await expect(configFrom({ notificationChannel: "mod-log" })).resolves.toMatchObject({
                alertChannel: "mod-log",
            });
            await expect(
                configFrom({ notificationChannel: "mod-log", alertChannel: "#alerts" }),
            ).resolves.toMatchObject({
                alertChannel: "alerts",
            });
        },
    );

    it("reads excluded moderators as lower-cased names, leaving out blanks", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        await expect(configFrom({ excludedModerators: " ModA, ,BotName " })).resolves.toMatchObject({
            excludedModerators: ["moda", "botname"],
        });
        await expect(configFrom({ excludedModerators: ["ModA"] })).resolves.toMatchObject({ excludedModerators: [] });
    });

    it(
        "reads the enabled actions that are text, and none from a value that is not a list",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            await expect(configFrom({ enabledActions: ["removelink", 3, "banuser"] })).resolves.toMatchObject({
                enabledActions: ["removelink", "banuser"],
            });
            await expect(configFrom({ enabledActions: "removelink" })).resolves.toMatchObject({ enabledActions: [] });
        },
    );

    it("reads a switch only from a true or false, else gives its default", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        await expect(
            configFrom({ flagUnknownModerators: false, includeModNote: "false", enableAutoModAlerts: 1 }),
        ).resolves.toMatchObject({ flagUnknownModerators: false, includeModNote: true, enableAutoModAlerts: false });
    });

    it.each([
        ["a Slack webhook, trimmed", ` ${WEBHOOK_URL} `, WEBHOOK_URL],
        ["one that is not https, as none", "http://hooks.slack.com/services/T000/B000/XXXX", ""],
        ["one on another host, as none", "https://example.com/hook", ""],
    ])("reads %s", TEST_OPTIONS, async (_label: string, value: string, url: string): Promise<void> => {
        expect.hasAssertions();

        await expect(configFrom({ slackWebhookUrl: value })).resolves.toMatchObject({ slackWebhookUrl: url });
    });
});

// One app process can serve several installations, each with its own settings.
describe("settings that cannot be read", (): void => {
    it("give, logged, the configuration last read for the installation", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const load = createConfigLoader();
        const { context } = createFakeContext({ ...defaultSettings(), modqueueThreshold: 7 });
        await load(context.settings, "t5_one");
        const failure = new Error("settings unavailable");
        context.settings.get.mockRejectedValue(failure);

        await expect(load(context.settings, "t5_one")).resolves.toMatchObject({ modqueueThreshold: 7 });
        expect(console.error).toHaveBeenCalledWith(
            "Failed to load configuration - check settings format and values:",
            failure,
        );
    });

    it("give the defaults to an installation never read, never another's", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const load = createConfigLoader();
        const { context } = createFakeContext(defaultSettings());
        await load(context.settings, "t5_one");
        context.settings.get.mockRejectedValue(new Error("settings unavailable"));

        await expect(load(context.settings, "t5_other")).resolves.toMatchObject({ slackWebhookUrl: "" });
    });
});
