import type { TriggerContext } from '@devvit/public-api';
import type { MonitorScheduler } from '../application/ports';

/** The scheduler job the composition root registers to run the monitor. */
export const MONITOR_JOB_NAME = 'modqueueMonitor';

export function createDevvitMonitorScheduler(
  scheduler: Pick<TriggerContext['scheduler'], 'runJob' | 'cancelJob' | 'listJobs'>,
): MonitorScheduler {
  return {
    schedule: (cron) => scheduler.runJob({ name: MONITOR_JOB_NAME, cron }),
    cancel: (jobId) => scheduler.cancelJob(jobId),
    async jobs() {
      return (await scheduler.listJobs()).map((job) => ({
        id: job.id,
        cron: 'cron' in job && job.cron ? job.cron : undefined,
      }));
    },
  };
}
