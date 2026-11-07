/** What an entry in Reddit's mod notes about a user records; "other" for kinds a ban alert does not count. */
export type NoteKind = "removal" | "spam" | "ban" | "mute" | "note" | "other";

/** An entry in a user's mod notes: its kind and when it was made. Never its text. */
export interface NoteEntry {
    readonly kind: NoteKind;
    readonly createdAt: Date;
}

/** How many of each counted kind of note a user had. */
export type HistoryCounts = Readonly<Record<Exclude<NoteKind, "other">, number>>;

/** What a user's mod notes record in the `days` before an action. */
export interface RecentHistory {
    readonly days: number;
    readonly counts: HistoryCounts;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1000;
const NONE: HistoryCounts = { removal: 0, spam: 0, ban: 0, mute: 0, note: 0 };

/**
 * Counts, by kind, the user's notes from the `days` before `at`. Reddit notes an action as it is made, to the
 * second, so notes from the second of `at` on are the action's own, and are left out.
 */
export function recentHistory(notes: readonly NoteEntry[], at: Date, days: number): RecentHistory {
    const end = Math.floor(at.getTime() / MS_PER_SECOND) * MS_PER_SECOND;
    const start = end - days * MS_PER_DAY;
    const counts = notes.reduce((total: HistoryCounts, { kind, createdAt }: NoteEntry): HistoryCounts => {
        const time = createdAt.getTime();
        return kind === "other" || time < start || time >= end ? total : { ...total, [kind]: total[kind] + 1 };
    }, NONE);
    return { days, counts };
}
