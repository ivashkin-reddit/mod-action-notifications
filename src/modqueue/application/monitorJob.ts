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
 * Leaves the scheduler running exactly what the thresholds call for: one monitor job on MONITOR_CRON while either
 * alert is on, none while both are off. It reads the scheduler rather than the remembered job ID, so it also
 * replaces a job that no longer exists, and cancels jobs left by an interrupted or overlapping setup or scheduled
 * on an older cron. Rejects, after logging, when scheduling fails.
 */
export async function setupMonitoring(thresholds: MonitorThresholds, ports: MonitorJobPorts): Promise<MonitoringSetup> {
    const enabled = isMonitoringEnabled(thresholds);
    const jobs = await ports.scheduler.jobs();
    const kept = enabled ? jobs.find((job: ScheduledMonitorJob): boolean => job.cron === MONITOR_CRON) : undefined;
    await cancelJobs(
        jobs.filter((job: ScheduledMonitorJob): boolean => job !== kept),
        ports.scheduler,
    );

    if (!enabled) {
        await ports.store.forgetMonitorJob();
        return { enabled: false };
    }
    const jobId = kept?.id ?? (await scheduleMonitor(ports.scheduler));
    await ports.store.rememberMonitorJob(jobId);
    return { enabled: true, jobId };
}

export type MonitorJobStatus =
    | { readonly state: "not-scheduled" }
    | { readonly state: "active"; readonly cron?: string }
    /** The remembered job is no longer scheduled. */
    | { readonly state: "stale" }
    /** The scheduler could not say. */
    | { readonly state: "unknown" }
    /** The remembered job could not be read. */
    | { readonly state: "unavailable" };

async function scheduledStatus(jobId: string, scheduler: MonitorScheduler): Promise<MonitorJobStatus> {
    try {
        const job = (await scheduler.jobs()).find((entry): boolean => entry.id === jobId);
        if (job === undefined) {
            return { state: "stale" };
        }
        return job.cron === undefined ? { state: "active" } : { state: "active", cron: job.cron };
    } catch {
        return { state: "unknown" };
    }
}

export async function monitorJobStatus(ports: MonitorJobPorts): Promise<MonitorJobStatus> {
    // null: the remembered job could not be read; undefined: no job is remembered.
    const jobId = await ports.store.monitorJobId().catch((): null => null);
    if (jobId === null) {
        return { state: "unavailable" };
    }
    if (jobId === undefined || jobId === "") {
        return { state: "not-scheduled" };
    }
    return await scheduledStatus(jobId, ports.scheduler);
}
