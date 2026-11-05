/** What the app notes having done, for Show Bot Status and the daily summary. */
export type HealthEvent =
    | "mod-action"
    | "post-delete"
    | "comment-delete"
    | "alert-delivered"
    | "alert-dropped"
    | "monitor-success"
    | "monitor-failure";

/** When each event last happened, in ms since the epoch; absent for one not seen lately. */
export type LastSeen = Readonly<Partial<Record<HealthEvent, number>>>;

/** How many of each event a day saw; absent for none. */
export type Counts = Readonly<Partial<Record<HealthEvent, number>>>;

const DATE_LENGTH = 10;

/** The UTC day an instant falls on, as the daily counts are kept: 2026-11-04. */
export function dayOf(ms: number): string {
    return new Date(ms).toISOString().slice(0, DATE_LENGTH);
}
