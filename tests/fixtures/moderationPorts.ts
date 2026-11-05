import { vi } from "vitest";
import type { ModerationPorts } from "../../src/moderation/application/notifyModAction.js";
import type { ModActionAlerts, ModerationLookups, ModerationRecords } from "../../src/moderation/application/ports.js";
import type { BanLogEntry } from "../../src/moderation/domain/banDuration.js";
import type { DisciplineEvent } from "../../src/moderation/domain/discipline.js";
import type { Actor, ModAction } from "../../src/moderation/domain/modAction.js";

/** An alert the mod-action ports were asked to send. */
export type Reported = Readonly<{ modAction: ModAction; actor: Actor }>;

/** Ports that work as Redis and Reddit would: what is recorded is read back, and an ID is claimed once. */
export function workingPorts(
    moderators: readonly string[] = ["ModA"],
): ModerationPorts & Readonly<{ reports: Reported[] }> {
    const reports: Reported[] = [];
    const events: DisciplineEvent[] = [];
    const claimed = new Set<string>();
    return {
        reports,
        records: {
            countAction: vi.fn<ModerationRecords["countAction"]>(async (): Promise<number> => await Promise.resolve(1)),
            recordDiscipline: vi.fn<ModerationRecords["recordDiscipline"]>(async (_subject, event): Promise<void> => {
                events.push(event);
                await Promise.resolve();
            }),
            disciplineEvents: vi.fn<ModerationRecords["disciplineEvents"]>(
                async (): Promise<readonly DisciplineEvent[]> => await Promise.resolve([...events]),
            ),
            claimReport: vi.fn<ModerationRecords["claimReport"]>(async (id: string): Promise<boolean> => {
                const first = !claimed.has(id);
                claimed.add(id);
                return await Promise.resolve(first);
            }),
        },
        lookups: {
            isModerator: vi.fn<ModerationLookups["isModerator"]>(
                async (username: string): Promise<boolean> => await Promise.resolve(moderators.includes(username)),
            ),
            recentBans: vi.fn<ModerationLookups["recentBans"]>(
                async (): Promise<readonly BanLogEntry[]> => await Promise.resolve([]),
            ),
        },
        alerts: {
            report: vi.fn<ModActionAlerts["report"]>(async (reported: ModAction, actor: Actor): Promise<void> => {
                reports.push({ modAction: reported, actor });
                await Promise.resolve();
            }),
        },
    };
}
