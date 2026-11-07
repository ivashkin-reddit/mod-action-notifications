import { vi } from "vitest";
import type { ModerationPorts } from "../../src/moderation/application/notifyModAction.js";
import type {
    BurstJoin,
    BurstRecords,
    BurstSchedule,
    ModActionAlerts,
    ModerationLookups,
    ModerationRecords,
} from "../../src/moderation/application/ports.js";
import type { ModeratorRef } from "../../src/moderation/domain/activity.js";
import type { BanLogEntry } from "../../src/moderation/domain/banDuration.js";
import type { Burst, BurstSummary, RemovalType } from "../../src/moderation/domain/burst.js";
import type { DisciplineEvent } from "../../src/moderation/domain/discipline.js";
import type { NoteEntry } from "../../src/moderation/domain/history.js";
import type { Actor, ModAction } from "../../src/moderation/domain/modAction.js";

/** An alert the mod-action ports were asked to send. */
export type Reported = Readonly<{ modAction: ModAction; actor: Actor; opensBurst: boolean }>;

/** A burst summary's run the ports were asked to schedule. */
export type Scheduled = Readonly<{ account: ModeratorRef; due: number }>;

const NO_COUNTS: Burst["counts"] = { removelink: 0, removecomment: 0, spamlink: 0, spamcomment: 0 };

function accountKey({ subredditName, moderatorName }: ModeratorRef): string {
    return `${subredditName}:${moderatorName}`;
}

/** The open bursts, by account, as functions over a store only they hold. */
type OpenBursts = Readonly<{
    get: (account: ModeratorRef) => Burst | undefined;
    put: (account: ModeratorRef, burst: Burst) => void;
    take: (account: ModeratorRef) => Burst | undefined;
    /** Changes the open burst, if one is open. */
    change: (account: ModeratorRef, changed: (current: Burst) => Burst) => void;
}>;

function openBursts(): OpenBursts {
    const open = new Map<string, Burst>();
    const get = (account: ModeratorRef): Burst | undefined => open.get(accountKey(account));
    return {
        get,
        put: (account: ModeratorRef, burst: Burst): void => {
            open.set(accountKey(account), burst);
        },
        take: (account: ModeratorRef): Burst | undefined => {
            const burst = get(account);
            open.delete(accountKey(account));
            return burst;
        },
        change: (account: ModeratorRef, changed: (current: Burst) => Burst): void => {
            const burst = get(account);
            if (burst !== undefined) {
                open.set(accountKey(account), changed(burst));
            }
        },
    };
}

/** A claim taken once each, as SET NX takes it. */
function claimOnce(): (claim: string) => Promise<boolean> {
    const claimed = new Set<string>();
    return async (claim: string): Promise<boolean> => {
        const first = !claimed.has(claim);
        claimed.add(claim);
        return await Promise.resolve(first);
    };
}

/** Counts the removal in the account's burst, opening one when none is open, as the Redis transaction does. */
function joinIn(open: OpenBursts): BurstRecords["join"] {
    return async (account: ModeratorRef, type: RemovalType, now: number): Promise<BurstJoin> => {
        const existing = open.get(account);
        const burst = existing ?? { opened: now, last: now, due: undefined, progressAt: undefined, counts: NO_COUNTS };
        open.put(account, { ...burst, last: now, counts: { ...burst.counts, [type]: burst.counts[type] + 1 } });
        return await Promise.resolve({ opened: existing === undefined, openedAt: burst.opened, due: burst.due });
    };
}

/** Burst records that work as Redis would: one burst open per account, closed at once, each claim taken once. */
function workingBursts(): BurstRecords {
    const open = openBursts();
    const claim = claimOnce();
    return {
        join: vi.fn<BurstRecords["join"]>(joinIn(open)),
        setDue: vi.fn<BurstRecords["setDue"]>(async (account: ModeratorRef, due: number): Promise<void> => {
            open.change(account, (current: Burst): Burst => ({ ...current, due }));
            await Promise.resolve();
        }),
        read: vi.fn<BurstRecords["read"]>(
            async (account: ModeratorRef): Promise<Burst | undefined> => await Promise.resolve(open.get(account)),
        ),
        noteProgress: vi.fn<BurstRecords["noteProgress"]>(async (account: ModeratorRef, at: number): Promise<void> => {
            open.change(account, (current: Burst): Burst => ({ ...current, progressAt: at }));
            await Promise.resolve();
        }),
        close: vi.fn<BurstRecords["close"]>(
            async (account: ModeratorRef): Promise<Burst | undefined> => await Promise.resolve(open.take(account)),
        ),
        discard: vi.fn<BurstRecords["discard"]>(async (account: ModeratorRef): Promise<void> => {
            open.take(account);
            await Promise.resolve();
        }),
        claimRun: vi.fn<BurstRecords["claimRun"]>(
            async (account: ModeratorRef, due: number): Promise<boolean> =>
                await claim(`run:${accountKey(account)}:${String(due)}`),
        ),
        claimRescue: vi.fn<BurstRecords["claimRescue"]>(
            async (account: ModeratorRef, since: number): Promise<boolean> =>
                await claim(`rescue:${accountKey(account)}:${String(since)}`),
        ),
    };
}

/** Moderation records that work as Redis would: what is recorded is read back, and an ID is claimed once. */
function workingRecords(): ModerationRecords {
    const events: DisciplineEvent[] = [];
    const claim = claimOnce();
    return {
        countAction: vi.fn<ModerationRecords["countAction"]>(async (): Promise<number> => await Promise.resolve(1)),
        recordDiscipline: vi.fn<ModerationRecords["recordDiscipline"]>(async (_subject, event): Promise<void> => {
            events.push(event);
            await Promise.resolve();
        }),
        disciplineEvents: vi.fn<ModerationRecords["disciplineEvents"]>(
            async (): Promise<readonly DisciplineEvent[]> => await Promise.resolve([...events]),
        ),
        claimReport: vi.fn<ModerationRecords["claimReport"]>(async (id: string): Promise<boolean> => await claim(id)),
    };
}

function workingLookups(moderators: readonly string[]): ModerationLookups {
    return {
        isModerator: vi.fn<ModerationLookups["isModerator"]>(
            async (username: string): Promise<boolean> => await Promise.resolve(moderators.includes(username)),
        ),
        recentBans: vi.fn<ModerationLookups["recentBans"]>(
            async (): Promise<readonly BanLogEntry[]> => await Promise.resolve([]),
        ),
        modNotes: vi.fn<ModerationLookups["modNotes"]>(
            async (): Promise<readonly NoteEntry[]> => await Promise.resolve([]),
        ),
    };
}

/** Alerts recorded as they are sent: each mod action's, and each burst's summary. */
function recordedAlerts(): Readonly<{ alerts: ModActionAlerts; reports: Reported[]; summaries: BurstSummary[] }> {
    const reports: Reported[] = [];
    const summaries: BurstSummary[] = [];
    return {
        reports,
        summaries,
        alerts: {
            report: vi.fn<ModActionAlerts["report"]>(
                async (reported: ModAction, actor: Actor, opensBurst: boolean): Promise<void> => {
                    reports.push({ modAction: reported, actor, opensBurst });
                    await Promise.resolve();
                },
            ),
            reportBurst: vi.fn<ModActionAlerts["reportBurst"]>(async (summary: BurstSummary): Promise<void> => {
                summaries.push(summary);
                await Promise.resolve();
            }),
        },
    };
}

/** A burst schedule recording what it was asked to run, and when. */
function recordedSchedule(): Readonly<{ burstSchedule: BurstSchedule; scheduled: Scheduled[] }> {
    const scheduled: Scheduled[] = [];
    return {
        scheduled,
        burstSchedule: {
            summariseAt: vi.fn<BurstSchedule["summariseAt"]>(
                async (account: ModeratorRef, due: number): Promise<void> => {
                    scheduled.push({ account, due });
                    await Promise.resolve();
                },
            ),
        },
    };
}

/** Ports that work as Redis and Reddit would: what is recorded is read back, and an ID is claimed once. */
export function workingPorts(
    moderators: readonly string[] = ["ModA"],
): ModerationPorts & Readonly<{ reports: Reported[]; summaries: BurstSummary[]; scheduled: Scheduled[] }> {
    const { alerts, reports, summaries } = recordedAlerts();
    const { burstSchedule, scheduled } = recordedSchedule();
    return {
        reports,
        summaries,
        scheduled,
        records: workingRecords(),
        lookups: workingLookups(moderators),
        alerts,
        bursts: workingBursts(),
        burstSchedule,
    };
}
