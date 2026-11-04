/** An item waiting in the modqueue. */
export interface QueueItem {
  kind: 'post' | 'comment';
  createdAt: Date;
  permalink: string;
}

export interface MonitorThresholds {
  /** Alert when the queue holds at least this many items; 0 turns the alert off. */
  queueSizeThreshold: number;
  /** Alert when items have waited at least this many hours; 0 turns the alert off. */
  unmoderatedAgeHours: number;
}

/** The monitor runs every 15 minutes. */
export const MONITOR_CRON = '*/15 * * * *';

/** Each kind of queue alert is sent at most once an hour. */
export const ALERT_PERIOD_SECONDS = 60 * 60;

/** The unmoderated-content alert lists this many of the oldest items. */
export const OLDEST_ITEMS_LISTED = 5;

/** Moderators are alerted when the monitor fails this many times in a row. */
export const FAILURES_BEFORE_ALERT = 3;

/** A run of failures is forgotten an hour after the last one. */
export const FAILURE_MEMORY_SECONDS = 60 * 60;

/** The monitor is scheduled only while at least one of its alerts is on. */
export function isMonitoringEnabled(thresholds: MonitorThresholds): boolean {
  return thresholds.queueSizeThreshold > 0 || thresholds.unmoderatedAgeHours > 0;
}

export function isQueueTooLong(size: number, queueSizeThreshold: number): boolean {
  return queueSizeThreshold > 0 && size >= queueSizeThreshold;
}

export function countByKind(items: QueueItem[]): { posts: number; comments: number } {
  const posts = items.filter((item) => item.kind === 'post').length;
  return { posts, comments: items.length - posts };
}

/** Items that have waited at least `ageHours` at `now`, oldest first. */
export function waitingTooLong(items: QueueItem[], ageHours: number, now: number): QueueItem[] {
  const ageThresholdMs = ageHours * 60 * 60 * 1000;
  return items
    .filter((item) => now - new Date(item.createdAt).getTime() >= ageThresholdMs)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}
