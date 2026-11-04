/** An item waiting in the modqueue. */
export interface QueueItem {
    readonly kind: "post" | "comment";
    readonly createdAt: Date;
    readonly permalink: string;
}

export interface MonitorThresholds {
    /** Alert when the queue holds at least this many items; 0 turns the alert off. */
    readonly queueSizeThreshold: number;
    /** Alert when items have waited at least this many hours; 0 turns the alert off. */
    readonly unmoderatedAgeHours: number;
}

const SECONDS_PER_HOUR = 3600;
const MS_PER_HOUR = 3_600_000;

/** The monitor runs every 15 minutes. */
export const MONITOR_CRON = "*/15 * * * *";

/** Each kind of queue alert is sent at most once an hour. */
export const ALERT_PERIOD_SECONDS = SECONDS_PER_HOUR;

/** The unmoderated-content alert lists this many of the oldest items. */
export const OLDEST_ITEMS_LISTED = 5;

/** Moderators are alerted when the monitor fails this many times in a row. */
export const FAILURES_BEFORE_ALERT = 3;

/** A run of failures is forgotten an hour after the last one. */
export const FAILURE_MEMORY_SECONDS = SECONDS_PER_HOUR;

/** The monitor is scheduled only while at least one of its alerts is on. */
export function isMonitoringEnabled(thresholds: MonitorThresholds): boolean {
    return thresholds.queueSizeThreshold > 0 || thresholds.unmoderatedAgeHours > 0;
}

export function isQueueTooLong(size: number, queueSizeThreshold: number): boolean {
    return queueSizeThreshold > 0 && size >= queueSizeThreshold;
}

export function countByKind(items: readonly QueueItem[]): { readonly posts: number; readonly comments: number } {
    const posts = items.filter((item: QueueItem): boolean => item.kind === "post").length;
    return { posts, comments: items.length - posts };
}

/** How many whole hours the item has waited at `now`. */
export function hoursWaiting(item: QueueItem, now: number): number {
    return Math.floor((now - item.createdAt.getTime()) / MS_PER_HOUR);
}

/** Items that have waited at least `ageHours` at `now`, oldest first. */
export function waitingTooLong(items: readonly QueueItem[], ageHours: number, now: number): readonly QueueItem[] {
    const ageThresholdMs = ageHours * MS_PER_HOUR;
    return items
        .filter((item: QueueItem): boolean => now - item.createdAt.getTime() >= ageThresholdMs)
        .sort((first: QueueItem, second: QueueItem): number => first.createdAt.getTime() - second.createdAt.getTime());
}
