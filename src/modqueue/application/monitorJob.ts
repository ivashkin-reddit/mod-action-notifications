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
            // A job that cannot be cancelled has already gone.
            await scheduler.cancel(job.id).catch((): undefined => undefined);
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
 * Leaves the scheduler running exactly what the thresholds call for: one monitor job on MONITOR_CRON while any of
 * its alerts is on, none while all are off. It reads the scheduler, so it also cancels jobs left by an interrupted
 * or overlapping setup or scheduled on an older cron. Rejects, after logging, when scheduling fails.
 */
export async function setupMonitoring(thresholds: MonitorThresholds, ports: MonitorJobPorts): Promise<MonitoringSetup> {
    const enabled = isMonitoringEnabled(thresholds);
    const jobs = await ports.scheduler.jobs();
    const kept = enabled ? jobs.find((job: ScheduledMonitorJob): boolean => job.cron === MONITOR_CRON) : undefined;
    await cancelJobs(
        jobs.filter((job: ScheduledMonitorJob): boolean => job !== kept),
        ports.scheduler,
    );
    // Cleanup only: a job ID left behind is never read.
    await ports.store.forgetLegacyJobId().catch((): undefined => undefined);

    if (!enabled) {
        return { enabled: false };
    }
    return { enabled: true, jobId: kept?.id ?? (await scheduleMonitor(ports.scheduler)) };
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
    } catch {
        return { state: "unknown" };
    }
}
