import { isMonitoringEnabled, MONITOR_CRON } from "../domain/monitoring.js";
import type { MonitorThresholds } from "../domain/monitoring.js";
import type { MonitorScheduler, MonitorStore, ScheduledMonitorJob } from "./ports.js";

export interface MonitorJobPorts {
    readonly store: MonitorStore;
    readonly scheduler: MonitorScheduler;
}

export interface MonitoringSetup {
    readonly enabled: boolean;
    /** The scheduled job, when monitoring is enabled. */
    readonly jobId?: string;
}

async function cancelJobs(jobs: readonly ScheduledMonitorJob[], scheduler: MonitorScheduler): Promise<void> {
    await Promise.all(
        jobs.map(async (job: ScheduledMonitorJob): Promise<void> => {
            // Setup goes on to leave one job scheduled; a job left behind, if it still exists, the next setup cancels.
            await scheduler.cancel(job.id).catch((error: unknown): void => {
                console.error("Failed to cancel a modqueue monitor job:", { jobId: job.id, error });
            });
        }),
    );
}

async function scheduleMonitor(scheduler: MonitorScheduler): Promise<string> {
    try {
        return await scheduler.schedule(MONITOR_CRON);
    } catch (scheduleError) {
        console.error("Failed to schedule modqueue monitor job", scheduleError);
        throw scheduleError;
    }
}

/**
 * The monitor job to keep: the one with the lowest ID on MONITOR_CRON, so that setups running at once, listing the
 * same jobs, keep the same one. Undefined when `keep` is false or no job is on that schedule.
 */
function jobToKeep(jobs: readonly ScheduledMonitorJob[], keep: boolean): ScheduledMonitorJob | undefined {
    if (!keep) {
        return undefined;
    }
    return jobs.reduce<ScheduledMonitorJob | undefined>(
        (lowest: ScheduledMonitorJob | undefined, job: ScheduledMonitorJob): ScheduledMonitorJob | undefined =>
            job.cron === MONITOR_CRON && (lowest === undefined || job.id < lowest.id) ? job : lowest,
        undefined,
    );
}

/** Cancels every monitor job but the one to keep, and returns that one's ID. */
async function keepOne(scheduler: MonitorScheduler, keep: boolean): Promise<string | undefined> {
    const jobs = await scheduler.jobs();
    const kept = jobToKeep(jobs, keep);
    await cancelJobs(
        jobs.filter((job: ScheduledMonitorJob): boolean => job !== kept),
        scheduler,
    );
    return kept?.id;
}

/**
 * Schedules the monitor and settles on one job. Setups that run at once (AppUpgrade delivered twice, or a moderator
 * pressing Setup as the app installs) can each find no job and schedule one; listing again afterwards, each keeps
 * the same one and cancels the rest.
 */
async function scheduleOne(scheduler: MonitorScheduler): Promise<string> {
    const scheduled = await scheduleMonitor(scheduler);
    try {
        return (await keepOne(scheduler, true)) ?? scheduled;
    } catch (error) {
        // The job is scheduled; an extra one a concurrent setup left behind, the next setup cancels.
        console.error("Failed to list monitor jobs after scheduling one:", error);
        return scheduled;
    }
}

/**
 * Leaves the scheduler running exactly what the thresholds call for: one monitor job on MONITOR_CRON while any of
 * its alerts is on, none while all are off. It reads the scheduler, so it also cancels jobs left by an interrupted
 * or overlapping setup or scheduled on an older cron. Rejects, after logging, when scheduling fails.
 */
export async function setupMonitoring(thresholds: MonitorThresholds, ports: MonitorJobPorts): Promise<MonitoringSetup> {
    const enabled = isMonitoringEnabled(thresholds);
    const kept = await keepOne(ports.scheduler, enabled);
    // Cleanup only: a job ID left behind is never read, and the next setup deletes it.
    await ports.store.forgetLegacyJobId().catch((error: unknown): void => {
        console.error("Failed to delete the monitor job ID an earlier version kept:", error);
    });

    if (!enabled) {
        return { enabled: false };
    }
    return { enabled: true, jobId: kept ?? (await scheduleOne(ports.scheduler)) };
}

export type MonitorJobStatus =
    | { readonly state: "not-scheduled" }
    | { readonly state: "active"; readonly cron?: string }
    /** The scheduler could not say. */
    | { readonly state: "unknown" };

/** The monitor job the scheduler has, as Show Bot Status names it. */
export async function monitorJobStatus(scheduler: MonitorScheduler): Promise<MonitorJobStatus> {
    try {
        const [job] = await scheduler.jobs();
        if (job === undefined) {
            return { state: "not-scheduled" };
        }
        return job.cron === undefined ? { state: "active" } : { state: "active", cron: job.cron };
    } catch (error) {
        console.error("Failed to list scheduled jobs for the bot status:", error);
        return { state: "unknown" };
    }
}
