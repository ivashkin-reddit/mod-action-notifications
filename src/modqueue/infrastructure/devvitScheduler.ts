import type { TriggerContext } from "@devvit/public-api";
import type { MonitorScheduler, ScheduledMonitorJob } from "../application/ports.js";

/** The scheduler job the composition root registers to run the monitor. */
export const MONITOR_JOB_NAME = "modqueueMonitor";

type MonitorJobScheduler = Readonly<Pick<TriggerContext["scheduler"], "runJob" | "cancelJob" | "listJobs">>;
type ListedJob = Readonly<{ id: string; name: string; cron?: string }>;

function scheduledMonitorJob(job: ListedJob): ScheduledMonitorJob {
    return job.cron === undefined || job.cron === "" ? { id: job.id } : { id: job.id, cron: job.cron };
}

export function createDevvitMonitorScheduler(scheduler: MonitorJobScheduler): MonitorScheduler {
    return {
        schedule: async (cron: string): Promise<string> => await scheduler.runJob({ name: MONITOR_JOB_NAME, cron }),
        cancel: async (jobId: string): Promise<void> => {
            await scheduler.cancelJob(jobId);
        },
        jobs: async (): Promise<readonly ScheduledMonitorJob[]> =>
            (await scheduler.listJobs())
                .filter((job: ListedJob): boolean => job.name === MONITOR_JOB_NAME)
                .map(scheduledMonitorJob),
    };
}
