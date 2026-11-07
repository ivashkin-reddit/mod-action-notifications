import { describe, expect, it } from "vitest";
import { isPileUp, matchedReason } from "./reports.js";

const TEST_OPTIONS = { timeout: 1000 };

describe("an urgent reason", (): void => {
    it(
        "is the first configured reason a report's reason contains, ignoring case, as configured",
        TEST_OPTIONS,
        (): void => {
            expect.hasAssertions();

            const configured = [" Threats ", "personal information"];

            expect([
                matchedReason("Sharing PERSONAL information", configured),
                matchedReason("it is threats of violence", configured),
                matchedReason("Spam", configured),
                matchedReason("anything", ["", "  "]),
            ]).toStrictEqual(["personal information", "Threats", undefined, undefined]);
        },
    );
});

describe("reports piling up", (): void => {
    it("reach the threshold, while it is above 0", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([isPileUp(3, 3), isPileUp(2, 3), isPileUp(9, 0)]).toStrictEqual([true, false, false]);
    });
});
