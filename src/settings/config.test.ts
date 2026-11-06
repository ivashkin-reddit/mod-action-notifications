import { describe, expect, it } from "vitest";
import { BOT_TOKEN, createFakeContext, defaultSettings } from "../../tests/fixtures/fakeContext.js";
import type { Settings } from "../../tests/fixtures/fakeContext.js";
import { createConfigLoader } from "./config.js";
import type { AppConfig } from "./config.js";

const TEST_OPTIONS = { timeout: 1000 };

/** The configuration read from these settings. */
async function configFrom(settings: Readonly<Settings>): Promise<AppConfig> {
    return await createConfigLoader()(createFakeContext(settings).context.settings, "t5_one");
}

describe("reading the settings", (): void => {
    it("gives the defaults for settings never saved", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        await expect(configFrom({})).resolves.toStrictEqual({
            slackBotToken: "",
            enabledActions: [],
            excludedModerators: [],
            flagUnknownModerators: true,
            includeModNote: true,
            notificationChannel: "",
            alertChannel: "",
            slackRetentionDays: 90,
            modqueueThreshold: 50,
            unmoderatedAgeHours: 24,
            reportedContentAgeHours: 24,
            enableAutoModAlerts: false,
            postDeletionUpvoteThreshold: 100,
            dailySummary: false,
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
        ["a whole number of days", 30, 30],
        ["numeric text", "30", 30],
        ["more than 90 days, as 90", 120, 90],
        ["0, as 1 day", 0, 1],
        ["text that is no number, as the default of 90", "lots", 90],
    ])(
        "reads the Slack message retention given as %s",
        TEST_OPTIONS,
        async (_label: string, value: unknown, days: number): Promise<void> => {
            expect.hasAssertions();

            await expect(configFrom({ slackRetentionDays: value })).resolves.toMatchObject({
                slackRetentionDays: days,
            });
        },
    );

    it.each([
        ["an ID with spaces", " C0123MODS ", "C0123MODS"],
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
        ["a bot token, trimmed", ` ${BOT_TOKEN} `, BOT_TOKEN],
        ["a value of another type, as none", 5, ""],
    ])("reads %s", TEST_OPTIONS, async (_label: string, value: unknown, token: string): Promise<void> => {
        expect.hasAssertions();

        await expect(configFrom({ slackBotToken: value })).resolves.toMatchObject({ slackBotToken: token });
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
        expect(console.warn).toHaveBeenCalledExactlyOnceWith(
            "[settings] Could not read the settings, so using those last read:",
            failure,
        );
        expect(console.error).not.toHaveBeenCalled();
    });

    it(
        "give the defaults, with no alerts, to an installation never read, never another's: an error",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const load = createConfigLoader();
            const { context } = createFakeContext(defaultSettings());
            await load(context.settings, "t5_one");
            const failure = new Error("settings unavailable");
            context.settings.get.mockRejectedValue(failure);

            await expect(load(context.settings, "t5_other")).resolves.toMatchObject({ slackBotToken: "" });
            expect(console.error).toHaveBeenCalledExactlyOnceWith(
                "[settings] Could not read the settings, so no alerts are sent until they can be:",
                failure,
            );
        },
    );
});
