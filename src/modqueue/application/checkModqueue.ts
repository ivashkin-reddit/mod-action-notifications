import {
  ALERT_PERIOD_SECONDS,
  countByKind,
  FAILURE_MEMORY_SECONDS,
  FAILURES_BEFORE_ALERT,
  isQueueTooLong,
  OLDEST_ITEMS_LISTED,
  waitingTooLong,
  type MonitorThresholds,
} from '../domain/monitoring';
import type { Modqueue, ModqueueAlerts, MonitorStore } from './ports';

export interface ModqueueConfig extends MonitorThresholds {
  /** Whether alerts have somewhere to go; the monitor does nothing without. */
  alertsConfigured: boolean;
}

export interface CheckModqueuePorts {
  openModqueue(): Promise<Modqueue>;
  store: MonitorStore;
  alerts: ModqueueAlerts;
}

/**
 * One run of the modqueue monitor: alerts when the queue is too long or items have waited too long, each at
 * most once an hour. A run that fails to read the queue is counted, and the third failure in a row alerts
 * moderators; the run then rejects so the scheduler records the failure. Failing to open the modqueue at all
 * rejects without being counted.
 */
export async function checkModqueue(config: ModqueueConfig, ports: CheckModqueuePorts): Promise<void> {
  if (!config.alertsConfigured) {
    return;
  }

  const modqueue = await ports.openModqueue();

  try {
    const items = await modqueue.items();

    if (
      isQueueTooLong(items.length, config.queueSizeThreshold) &&
      (await ports.store.claimAlert('modqueue_size', ALERT_PERIOD_SECONDS))
    ) {
      await ports.alerts.queueTooLong({ size: items.length, ...countByKind(items), threshold: config.queueSizeThreshold });
    }

    if (config.unmoderatedAgeHours > 0) {
      const now = Date.now();
      const waiting = waitingTooLong(items, config.unmoderatedAgeHours, now);
      if (waiting.length > 0 && (await ports.store.claimAlert('modqueue_unmoderated', ALERT_PERIOD_SECONDS))) {
        await ports.alerts.waitingTooLong({
          oldest: waiting.slice(0, OLDEST_ITEMS_LISTED),
          total: waiting.length,
          ageHours: config.unmoderatedAgeHours,
          now,
        });
      }
    }

    try {
      await ports.store.clearFailures();
    } catch {
      // A stale failure count expires within the hour.
    }
  } catch (error) {
    console.error('Failed to check modqueue:', error);
    if (error instanceof Error) {
      await countFailure(config, ports, error);
    }
    throw error;
  }
}

async function countFailure(config: ModqueueConfig, ports: CheckModqueuePorts, error: Error): Promise<void> {
  try {
    const failures = await ports.store.countFailure();
    if (failures >= FAILURES_BEFORE_ALERT) {
      if (config.alertsConfigured) {
        await ports.alerts.monitorFailing({ failures, error: error.message });
      }
      await ports.store.clearFailures();
    } else {
      await ports.store.expireFailuresAfter(FAILURE_MEMORY_SECONDS);
    }
  } catch {
    // Failure tracking must not break the scheduler.
    console.error('Failed to track scheduler failures');
  }
}
