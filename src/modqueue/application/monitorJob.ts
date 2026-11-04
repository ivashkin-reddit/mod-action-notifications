import { isMonitoringEnabled, MONITOR_CRON } from "../domain/monitoring.js";
import type { MonitorThresholds } from "../domain/monitoring.js";
import type { MonitorScheduler, MonitorStore } from "./ports.js";

export interface MonitorJobPorts {
    readonly store: MonitorStore;
    readonly scheduler: MonitorScheduler;
}

export interface MonitoringSetup {
    readonly enabled: boolean;
    /** The scheduled job, when monitoring is enabled. */
    readonly jobId?: string;
}

async function cancelMonitoring(existingJobId: string | undefined, ports: MonitorJobPorts): Promise<void> {
    if (existingJobId === undefined || existingJobId === "") {
        return;
    }
    try {
        await ports.scheduler.cancel(existingJobId);
    } catch {
        // The job is already gone; forget it either way.
    }
    await ports.store.forgetMonitorJob();
}

async function scheduleMonitoring(ports: MonitorJobPorts): Promise<MonitoringSetup> {
    try {
        const jobId = await ports.scheduler.schedule(MONITOR_CRON);
        await ports.store.rememberMonitorJob(jobId);
        return { enabled: true, jobId };
    } catch (scheduleError) {
        console.error("Failed to schedule modqueue monitor job", scheduleError);
        throw scheduleError;
    }
}

/**
 * Schedules the monitor when one of its alerts is on and it is not scheduled yet, and cancels it when both are
 * off. Rejects, after logging, when scheduling fails.
 */
export async function setupMonitoring(thresholds: MonitorThresholds, ports: MonitorJobPorts): Promise<MonitoringSetup> {
    const existingJobId = await ports.store.monitorJobId();

    if (!isMonitoringEnabled(thresholds)) {
        await cancelMonitoring(existingJobId, ports);
        return { enabled: false };
    }

    if (existingJobId !== undefined && existingJobId !== "") {
        return { enabled: true, jobId: existingJobId };
    }
    return await scheduleMonitoring(ports);
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
