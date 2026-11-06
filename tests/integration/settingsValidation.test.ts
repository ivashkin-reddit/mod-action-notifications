import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { App } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const NUMBER_PROBLEM = "Enter a whole number, 0 or more (0 turns this alert off)";
const RETENTION_PROBLEM = "Enter a whole number of days, from 1 to 90";
const THRESHOLDS = [
    ["modqueueThreshold"],
    ["unmoderagedAgeHours"],
    ["reportedContentAgeHours"],
    ["postDeletionUpvoteThreshold"],
    ["spamQueueThreshold"],
    ["editedQueueThreshold"],
];

/** What the settings form says of `value` for the named setting as a moderator saves it: a message rejects it. */
function validation(app: Readonly<Pick<App, "registrations">>, name: string, value: unknown): unknown {
    const validate = app.registrations.settings.find((candidate): boolean => candidate.name === name)?.onValidate;
    if (validate === undefined) {
        throw new Error(`${name} is not checked as it is saved`);
    }
    return validate({ value, isEditing: true }, {});
}

// The app remembers where its alerts are for as long as Slack keeps them, and can edit them for at most 90 days.
describe("saving the Slack message retention", (): void => {
    it("accepts a whole number of days from 1 to 90", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        expect(
            [undefined, 1, 30, 90].map((value: number | undefined): unknown =>
                validation(app, "slackRetentionDays", value),
            ),
        ).toStrictEqual([undefined, undefined, undefined, undefined]);
    });

    it("refuses any other number", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        expect(
            [0, 91, 30.5, -1].map((value: number): unknown => validation(app, "slackRetentionDays", value)),
        ).toStrictEqual(Array.from({ length: 4 }, (): string => RETENTION_PROBLEM));
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
