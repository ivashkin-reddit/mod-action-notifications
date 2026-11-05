import type { ScheduledJob } from "./fakeScheduler.js";

/** The scheduled jobs that are the monitor's: setup also keeps the daily summary's, which its own tests cover. */
export function monitorJobs(jobs: readonly ScheduledJob[]): readonly ScheduledJob[] {
    return jobs.filter((job: ScheduledJob): boolean => job.name === "modqueueMonitor");
}

/** The monitor jobs setup asked the scheduler for. */
export function monitorRuns(
    calls: readonly (readonly [Readonly<{ name: string }>])[],
): readonly Readonly<{ name: string }>[] {
    return calls
        .map(([job]: readonly [Readonly<{ name: string }>]): Readonly<{ name: string }> => job)
        .filter((job): boolean => job.name === "modqueueMonitor");
}
