import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const WEBHOOK_PROBLEM = "Enter a Slack incoming webhook URL, starting https://hooks.slack.com/";
const NUMBER_PROBLEM = "Enter a whole number, 0 or more (0 turns this alert off)";
const THRESHOLDS = [
    ["modqueueThreshold"],
    ["unmoderagedAgeHours"],
    ["reportedContentAgeHours"],
    ["postDeletionUpvoteThreshold"],
];

/** What the settings form says of `value` for the named setting as a moderator saves it: a message rejects it. */
function validation(app: Readonly<Pick<App, "registrations">>, name: string, value: unknown): unknown {
    const validate = app.registrations.settings.find((candidate): boolean => candidate.name === name)?.onValidate;
    if (validate === undefined) {
        throw new Error(`${name} is not checked as it is saved`);
    }
    return validate({ value, isEditing: true }, {});
}

// Devvit lets the app fetch only hooks.slack.com, and moderators cannot see the app's logs: a webhook URL that cannot
// work is refused as it is saved rather than silently turning alerts off.
describe("saving the Slack webhook URL", (): void => {
    it.each([
        ["blank, which turns alerts off", ""],
        ["a Slack incoming webhook", "https://hooks.slack.com/services/T000/B000/XXXX"],
        ["one with spaces around it", "  https://hooks.slack.com/services/T000/B000/XXXX  "],
    ])("accepts %s", TEST_OPTIONS, async (_label: string, value: string): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        expect(validation(app, "slackWebhookUrl", value)).toBeUndefined();
    });

    it.each([
        ["one that is not https", "http://hooks.slack.com/services/T000/B000/XXXX"],
        ["another host", "https://example.com/hooks/slack"],
        ["a host that only starts like Slack's", "https://hooks.slack.com.example.com/services/X"],
        ["text that is not a URL", "hooks.slack.com/services/T000"],
    ])("refuses %s", TEST_OPTIONS, async (_label: string, value: string): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        expect(validation(app, "slackWebhookUrl", value)).toBe(WEBHOOK_PROBLEM);
    });

    // A URL saved before saving checked it is still read as no webhook, so alerts go nowhere they cannot reach.
    it("treats a webhook URL on another host, saved earlier, as none", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { slackWebhookUrl: "https://example.com/hooks/slack" });

        await app.fire("ModAction", removedPost());

        expect(app.slack.requests).toStrictEqual([]);
        expect(console.error).toHaveBeenCalledWith(
            "Invalid Slack webhook URL: must be an https://hooks.slack.com/ URL",
        );
    });
});

describe("saving a threshold", (): void => {
    it.each(THRESHOLDS)(
        "accepts a whole number of 0 or more for %s",
        TEST_OPTIONS,
        async (name: string): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            expect(
                [undefined, 0, 1, 500].map((value: number | undefined): unknown => validation(app, name, value)),
            ).toStrictEqual([undefined, undefined, undefined, undefined]);
        },
    );

    it.each(THRESHOLDS)(
        "refuses a negative or fractional number for %s",
        TEST_OPTIONS,
        async (name: string): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);

            expect([-1, 1.5].map((value: number): unknown => validation(app, name, value))).toStrictEqual([
                NUMBER_PROBLEM,
                NUMBER_PROBLEM,
            ]);
        },
    );
});
