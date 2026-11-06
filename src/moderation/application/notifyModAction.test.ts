import { describe, expect, it, vi } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import { modAction } from "../../../tests/fixtures/modActions.js";
import { workingPorts } from "../../../tests/fixtures/moderationPorts.js";
import type { Reported } from "../../../tests/fixtures/moderationPorts.js";
import type { BanLogEntry } from "../domain/banDuration.js";
import type { Actor } from "../domain/modAction.js";
import { notifyModAction } from "./notifyModAction.js";
import type { ModerationConfig } from "./notifyModAction.js";

const TEST_OPTIONS = { timeout: 1000 };
const HOUR = 3_600_000;
const FAILURE = new Error("storage down");

const CONFIG: ModerationConfig = {
    enabledActions: ["removelink", "banuser", "unbanuser"],
    excludedModerators: [],
    enableAutoModAlerts: false,
    securityAlerts: false,
    flagUnknownModerators: true,
};

/** Who took an action, and how it is reported: whether the mod list is checked, and the actor it names. */
type ActorCase = Readonly<{
    label: string;
    moderatorName: string;
    onModList?: boolean;
    unflagged?: boolean;
    actor: Actor;
    looksUp: boolean;
}>;

function actors(reports: readonly Reported[]): Actor[] {
    return reports.map((report: Reported): Actor => report.actor);
}

describe("notifying moderators of a mod action", (): void => {
    it.each<ActorCase>([
        { label: "a moderator's as theirs", moderatorName: "ModA", onModList: true, actor: "moderator", looksUp: true },
        {
            label: "a stranger's as an unknown moderator's",
            moderatorName: "ModA",
            actor: "unknown-moderator",
            looksUp: true,
        },
        { label: "Reddit's own as Reddit's", moderatorName: "reddit", actor: "reddit", looksUp: false },
        { label: "one naming no moderator as a moderator's", moderatorName: "", actor: "moderator", looksUp: false },
        {
            label: "a stranger's, unflagged, as a moderator's",
            moderatorName: "ModA",
            unflagged: true,
            actor: "moderator",
            looksUp: false,
        },
    ])("reports $label", TEST_OPTIONS, async (actorCase: ActorCase): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts(actorCase.onModList === true ? ["ModA"] : []);
        const config = { ...CONFIG, flagUnknownModerators: actorCase.unflagged !== true };

        await notifyModAction(modAction({ moderatorName: actorCase.moderatorName }), config, ports);

        expect(actors(ports.reports)).toStrictEqual([actorCase.actor]);
        expect(vi.mocked(ports.lookups.isModerator).mock.calls.length > 0).toBe(actorCase.looksUp);
    });

    it("reports as a moderator's, logged, without the mod list", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();
        vi.mocked(ports.lookups.isModerator).mockRejectedValue(FAILURE);

        await notifyModAction(modAction(), CONFIG, ports);

        expect(actors(ports.reports)).toStrictEqual(["moderator"]);
        expect(console.warn).toHaveBeenCalledWith(
            "[modaction] Could not fetch the mod list, so treating the action as a moderator's:",
            FAILURE,
        );
    });

    it("neither reads nor records bans while unban alerts are off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts([]);

        await notifyModAction(modAction({ type: "banuser" }), { ...CONFIG, enabledActions: ["banuser"] }, ports);
        await notifyModAction(modAction({ type: "unbanuser" }), { ...CONFIG, enabledActions: ["banuser"] }, ports);

        expect(ports.records.recordDiscipline).not.toHaveBeenCalled();
        expect(ports.records.disciplineEvents).not.toHaveBeenCalled();
    });

    it("counts and records an action it does not report", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts([]);
        const ban = modAction({ type: "banuser" });

        // Ban alerts are off; unban alerts, which read the record, are on.
        await notifyModAction(ban, { ...CONFIG, enabledActions: ["unbanuser"] }, ports);

        expect(ports.reports).toStrictEqual([]);
        expect(ports.records.recordDiscipline).toHaveBeenCalledExactlyOnceWith(
            { kind: "ban", subredditName: "testsub", username: "Author" },
            {
                change: "imposed",
                at: NOW.getTime(),
                moderatorName: "ModA",
                details: undefined,
            },
        );
        expect(ports.records.countAction).toHaveBeenCalledExactlyOnceWith(
            { subredditName: "testsub", moderatorName: "ModA" },
            { id: "ModAction_1", at: NOW.getTime() },
            60_000,
        );
        expect(ports.lookups.isModerator).not.toHaveBeenCalled();
        expect(ports.records.claimReport).not.toHaveBeenCalled();
    });
});

describe("an action delivered again", (): void => {
    it("is reported once", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();

        await notifyModAction(modAction(), CONFIG, ports);
        await notifyModAction(modAction(), CONFIG, ports);

        expect(ports.reports).toHaveLength(1);
    });

    it("is reported each time when it has no ID to claim", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();

        await notifyModAction(modAction({ id: undefined }), CONFIG, ports);
        await notifyModAction(modAction({ id: undefined }), CONFIG, ports);

        expect(ports.reports).toHaveLength(2);
        expect(ports.records.claimReport).not.toHaveBeenCalled();
    });

    it("is reported, logged, when its claim cannot be stored", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();
        vi.mocked(ports.records.claimReport).mockRejectedValue(FAILURE);

        await notifyModAction(modAction(), CONFIG, ports);

        expect(ports.reports).toHaveLength(1);
        expect(console.warn).toHaveBeenCalledWith(
            "[modaction] Could not record that the action was alerted, so it may be alerted again:",
            FAILURE,
        );
    });
});

describe("a ban without a length", (): void => {
    const target = { author: "Troll", permalink: undefined, body: undefined, postId: undefined, commentId: undefined };
    const ban = modAction({ type: "banuser", target });
    const entry: BanLogEntry = {
        id: "ModAction_1",
        moderatorName: "ModA",
        createdAt: NOW,
        details: "7 day",
        description: "Trolling",
        targetAuthor: "Troll",
    };

    it("takes its length from the mod log", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();
        vi.mocked(ports.lookups.recentBans).mockResolvedValue([entry]);

        await notifyModAction(ban, CONFIG, ports);

        expect(ports.reports[0]?.modAction).toMatchObject({ banDuration: 7, description: "Trolling" });
    });

    it("is reported without one, logged, when the mod log cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();
        vi.mocked(ports.lookups.recentBans).mockRejectedValue(FAILURE);

        await notifyModAction(ban, CONFIG, ports);

        expect(ports.reports[0]?.modAction.banDuration).toBeUndefined();
        expect(console.warn).toHaveBeenCalledWith(
            "[modaction] Could not read the mod log for a ban's length, so alerting without it:",
            FAILURE,
        );
    });

    it("is not looked up when it says how long it is", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();

        await notifyModAction({ ...ban, details: "permanent" }, CONFIG, ports);

        expect(ports.lookups.recentBans).not.toHaveBeenCalled();
    });
});

describe("an unban", (): void => {
    const target = { author: "Troll", permalink: undefined, body: undefined, postId: undefined, commentId: undefined };
    const ban = modAction({
        id: "ModAction_ban",
        type: "banuser",
        details: "7 days",
        occurredAt: new Date(NOW.getTime() - HOUR),
        target,
    });
    const unban = modAction({ id: "ModAction_unban", type: "unbanuser", target });

    // The bans are read before the unban's own lifting is recorded: read after, the latest event would be the lifting.
    it("is reported with the ban it lifts", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();

        await notifyModAction(ban, CONFIG, ports);
        await notifyModAction(unban, CONFIG, ports);

        expect(ports.reports[1]?.modAction.relatedAction).toStrictEqual({
            moderatorName: "ModA",
            occurredAt: new Date(NOW.getTime() - HOUR),
            details: "7 days",
        });
    });

    it("is reported without the ban, logged, when the bans cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();
        await notifyModAction(ban, CONFIG, ports);
        vi.mocked(ports.records.disciplineEvents).mockRejectedValue(FAILURE);

        await notifyModAction(unban, CONFIG, ports);

        expect(ports.reports[1]?.modAction.relatedAction).toBeUndefined();
        expect(console.warn).toHaveBeenCalledWith(
            "[modaction] Could not read the user's bans and mutes, so alerting without the one lifted:",
            FAILURE,
        );
    });

    it("is still reported, logged, when it cannot be recorded", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();
        vi.mocked(ports.records.recordDiscipline).mockRejectedValue(FAILURE);

        await notifyModAction(unban, CONFIG, ports);

        expect(ports.reports).toHaveLength(1);
        expect(console.warn).toHaveBeenCalledWith(
            "[modaction] Could not record a ban or mute, so a later unban or unmute will not name it:",
            FAILURE,
        );
    });
});

describe("a moderator's activity", (): void => {
    it("marks the action that completes a spike", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();
        vi.mocked(ports.records.countAction).mockResolvedValue(5);

        await notifyModAction(modAction(), CONFIG, ports);

        expect(ports.reports[0]?.modAction.activitySpike).toStrictEqual({ count: 5, windowSeconds: 60 });
    });

    it("is reported without a spike, logged, uncounted", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const ports = workingPorts();
        vi.mocked(ports.records.countAction).mockRejectedValue(FAILURE);

        await notifyModAction(modAction(), CONFIG, ports);

        expect(ports.reports[0]?.modAction.activitySpike).toBeUndefined();
        expect(console.warn).toHaveBeenCalledWith(
            "[modaction] Could not count the moderator's action, so alerting without spike detection:",
            FAILURE,
        );
    });
});
