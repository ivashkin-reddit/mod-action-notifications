import { describe, expect, it } from "vitest";
import { modAction } from "../../../tests/fixtures/modActions.js";
import { isReported } from "./alerting.js";
import type { AlertRules } from "./alerting.js";

const TEST_OPTIONS = { timeout: 1000 };

const RULES: AlertRules = {
    enabledActions: ["removelink", "banuser"],
    excludedModerators: [],
    enableAutoModAlerts: false,
};

describe("an action moderators are told about", (): void => {
    it("is one of an enabled type", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([
            isReported(modAction({ type: "removelink" }), RULES),
            isReported(modAction({ type: "lock" }), RULES),
        ]).toStrictEqual([true, false]);
    });

    it("is not one by an excluded moderator, whatever the case of their name", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(isReported(modAction({ moderatorName: "ModA" }), { ...RULES, excludedModerators: ["moda"] })).toBe(
            false,
        );
    });

    it("is one whose event names no moderator, when moderators are excluded", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(isReported(modAction({ moderatorName: undefined }), { ...RULES, excludedModerators: ["moda"] })).toBe(
            true,
        );
    });

    it("is not AutoModerator's while AutoModerator alerts are off", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const action = modAction({ moderatorName: "AutoModerator", isAutoModerator: true });

        expect([isReported(action, RULES), isReported(action, { ...RULES, enableAutoModAlerts: true })]).toStrictEqual([
            false,
            true,
        ]);
    });

    // An event that names no type reads as "unknown", which is only reported when that is enabled.
    it("is one naming no type only when unknown actions are enabled", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const action = modAction({ type: "" });

        expect([
            isReported(action, RULES),
            isReported(action, { ...RULES, enabledActions: ["unknown"] }),
        ]).toStrictEqual([false, true]);
    });
});
