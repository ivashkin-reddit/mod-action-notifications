import { isMonitoringEnabled, MONITOR_CRON, type MonitorThresholds } from '../domain/monitoring';
import type { MonitorScheduler, MonitorStore } from './ports';

export interface MonitorJobPorts {
  store: MonitorStore;
  scheduler: MonitorScheduler;
}

/**
 * Schedules the monitor when one of its alerts is on and it is not scheduled yet, and cancels it when both are
 * off. Rejects, after logging, when scheduling fails.
 */
export async function setupMonitoring(
  thresholds: MonitorThresholds,
  ports: MonitorJobPorts,
): Promise<{ enabled: boolean; jobId?: string }> {
  const existingJobId = await ports.store.monitorJobId();

  if (!isMonitoringEnabled(thresholds)) {
    if (existingJobId) {
      try {
        await ports.scheduler.cancel(existingJobId);
      } catch {
        // The job is already gone.
      }
      await ports.store.forgetMonitorJob();
    }
    return { enabled: false };
  }

  if (existingJobId) {
    return { enabled: true, jobId: existingJobId };
  }

  try {
    const jobId = await ports.scheduler.schedule(MONITOR_CRON);
    await ports.store.rememberMonitorJob(jobId);
    return { enabled: true, jobId };
  } catch (scheduleError) {
    console.error('Failed to schedule modqueue monitor job', scheduleError);
    throw scheduleError;
  }
}

export type MonitorJobStatus =
  | { state: 'not-scheduled' }
  | { state: 'active'; cron?: string }
  /** The remembered job is no longer scheduled. */
  | { state: 'stale' }
  /** The scheduler could not say. */
  | { state: 'unknown' }
  /** The remembered job could not be read. */
  | { state: 'unavailable' };

export async function monitorJobStatus(ports: MonitorJobPorts): Promise<MonitorJobStatus> {
  let jobId: string | undefined;
  try {
    jobId = await ports.store.monitorJobId();
  } catch {
    return { state: 'unavailable' };
  }
  if (!jobId) {
    return { state: 'not-scheduled' };
  }

  try {
    const job = (await ports.scheduler.jobs()).find((entry) => entry.id === jobId);
    if (!job) {
      return { state: 'stale' };
    }
    return job.cron ? { state: 'active', cron: job.cron } : { state: 'active' };
  } catch {
    return { state: 'unknown' };
  }
}
