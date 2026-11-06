import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { removedPost } from "../fixtures/events.js";
import { createFakeContext, defaultSettings } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { MINUTE } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };

describe("the mod list", (): void => {
    it("is fetched once and reused for five minutes", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost());
        await app.advance(5 * MINUTE - 1);
        await app.fire("ModAction", removedPost());

        expect(app.context.reddit.getModerators).toHaveBeenCalledExactlyOnceWith();

        await app.advance(1);
        await app.fire("ModAction", removedPost());

        expect(app.context.reddit.getModerators).toHaveBeenCalledTimes(2);
    });

    it("is not asked of Reddit at all while the cached list is fresh", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", removedPost());
        await app.fire("ModAction", removedPost());

        expect(app.context.reddit.getCurrentSubreddit).toHaveBeenCalledExactlyOnceWith();
    });

    it(
        "is asked again for a name the cached list lacks: a moderator who joined since is not flagged",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            await app.fire("ModAction", removedPost());
            app.context.reddit.moderators = [...app.context.reddit.moderators, "NewMod"];
            await app.advance(MINUTE);

            await app.fire("ModAction", removedPost({ id: "ModAction_2", moderator: { name: "NewMod" } }));

            expect(app.slack.messages.map((message): string => message.text)).toStrictEqual([
                "🗑️ Post Removed",
                "🗑️ Post Removed",
            ]);
            expect(app.context.reddit.getModerators).toHaveBeenCalledTimes(2);
        },
    );

    // One app process can serve several subreddits, which may share a name across fakes but never a mod list.
    it("is kept for each installation the process serves", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const { context: otherInstallation } = createFakeContext(defaultSettings(), "t5_other");

        await app.fire("ModAction", removedPost());
        await app.fire("ModAction", removedPost(), otherInstallation);
        await app.fire("ModAction", removedPost());
        await app.fire("ModAction", removedPost(), otherInstallation);

        expect(app.context.reddit.getModerators).toHaveBeenCalledExactlyOnceWith();
        expect(otherInstallation.reddit.getModerators).toHaveBeenCalledExactlyOnceWith();
    });
});
