import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

// What changed in the installation, and the monitor's state after setup: a line each in the log.
describe("the log of installing or upgrading", (): void => {
    it.each([
        ["AppInstall", "[setup] Installed version 1.2.3"],
        ["AppUpgrade", "[setup] Upgraded to version 1.2.3"],
    ])("for %s names the version, then says the monitor is on", TEST_OPTIONS, async (trigger, line): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire(trigger, { type: trigger });

        expect(vi.mocked(console.info).mock.calls).toStrictEqual([[line], ["[setup] The modqueue monitor is on"]]);
    });

    it("says the monitor is off when all its thresholds are 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, {
            modqueueThreshold: 0,
            unmoderagedAgeHours: 0,
            reportedContentAgeHours: 0,
            modmailWaitHours: 0,
        });

        await app.fire("AppUpgrade", { type: "AppUpgrade" });

        expect(console.info).toHaveBeenLastCalledWith("[setup] The modqueue monitor is off: all its thresholds are 0");
    });
});
