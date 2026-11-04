import type { QueueItem } from '../domain/monitoring';

/** The subreddit's modqueue. */
export interface Modqueue {
  items(): Promise<QueueItem[]>;
}

export type QueueAlertType = 'modqueue_size' | 'modqueue_unmoderated';

/** What the monitor keeps between runs. */
export interface MonitorStore {
  /** Claims the alert for the period: false when one of that type was sent within it, true otherwise. */
  claimAlert(alert: QueueAlertType, periodSeconds: number): Promise<boolean>;
  /** Adds a failure to the count of consecutive failures and returns the new count. */
  countFailure(): Promise<number>;
  /** Forgets the failure count `seconds` from now, unless it changes first. */
  expireFailuresAfter(seconds: number): Promise<void>;
  clearFailures(): Promise<void>;
  monitorJobId(): Promise<string | undefined>;
  rememberMonitorJob(jobId: string): Promise<void>;
  forgetMonitorJob(): Promise<void>;
}

export interface MonitorScheduler {
  /** Schedules the monitor job and returns its ID. */
  schedule(cron: string): Promise<string>;
  cancel(jobId: string): Promise<void>;
  jobs(): Promise<{ id: string; cron?: string }[]>;
}

export interface ModqueueAlerts {
  queueTooLong(alert: { size: number; posts: number; comments: number; threshold: number }): Promise<void>;
  /** `oldest` are the oldest of `total` waiting items, oldest first; ages are measured at `now`. */
  waitingTooLong(alert: { oldest: QueueItem[]; total: number; ageHours: number; now: number }): Promise<void>;
  /** `error` is the last failure's message, '' when it had none. */
  monitorFailing(alert: { failures: number; error: string }): Promise<void>;
}
