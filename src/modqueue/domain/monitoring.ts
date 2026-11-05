/** An item waiting in the modqueue. */
export interface QueueItem {
    readonly kind: "post" | "comment";
    readonly createdAt: Date;
    readonly permalink: string;
}

export interface MonitorThresholds {
    /** Alert when the modqueue holds at least this many items; 0 turns the alert off. */
    readonly queueSizeThreshold: number;
    /** Alert when content has waited at least this many hours without a moderator reviewing it; 0 turns it off. */
    readonly unmoderatedAgeHours: number;
    /** Alert when reported content is at least this many hours old; 0 turns the alert off. */
    readonly reportedAgeHours: number;
}

const SECONDS_PER_HOUR = 3600;
const MS_PER_HOUR = 3_600_000;

/** The monitor runs every 15 minutes. */
export const MONITOR_CRON = "*/15 * * * *";

/** Each kind of queue alert is sent at most once an hour. */
export const ALERT_PERIOD_SECONDS = SECONDS_PER_HOUR;

/** The unmoderated and reported content alerts list this many of the oldest items. */
export const OLDEST_ITEMS_LISTED = 5;

/** Moderators are alerted when the monitor fails this many times in a row. */
export const FAILURES_BEFORE_ALERT = 3;

/** A run of failures is forgotten an hour after the last one. */
export const FAILURE_MEMORY_SECONDS = SECONDS_PER_HOUR;

/** Whether the alert a threshold sets is on: 0 turns it off. */
export function isAlertOn(threshold: number): boolean {
    return threshold > 0;
}

/** The monitor is scheduled only while at least one of its alerts is on. */
export function isMonitoringEnabled(thresholds: MonitorThresholds): boolean {
    return (
        isAlertOn(thresholds.queueSizeThreshold) ||
        isAlertOn(thresholds.unmoderatedAgeHours) ||
        isAlertOn(thresholds.reportedAgeHours)
    );
}

export function isQueueTooLong(size: number, queueSizeThreshold: number): boolean {
    return isAlertOn(queueSizeThreshold) && size >= queueSizeThreshold;
}

export function countByKind(items: readonly QueueItem[]): { readonly posts: number; readonly comments: number } {
    const posts = items.filter((item: QueueItem): boolean => item.kind === "post").length;
    return { posts, comments: items.length - posts };
}

/** How many whole hours the item has waited at `now`. */
export function hoursWaiting(item: QueueItem, now: number): number {
    return Math.floor((now - item.createdAt.getTime()) / MS_PER_HOUR);
}

/** Items created at least `ageHours` before `now`, oldest first. */
export function atLeastHoursOld(items: readonly QueueItem[], ageHours: number, now: number): readonly QueueItem[] {
    const ageThresholdMs = ageHours * MS_PER_HOUR;
    return items
        .filter((item: QueueItem): boolean => now - item.createdAt.getTime() >= ageThresholdMs)
        .sort((first: QueueItem, second: QueueItem): number => first.createdAt.getTime() - second.createdAt.getTime());
}
