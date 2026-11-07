import {
    ALERT_PERIOD_SECONDS,
    atLeastHoursOld,
    countByKind,
    FAILURE_MEMORY_SECONDS,
    FAILURES_BEFORE_ALERT,
    isAlertOn,
    isQueueTooLong,
    OLDEST_ITEMS_LISTED,
} from "../domain/monitoring.js";
import type { MonitorThresholds, QueueItem } from "../domain/monitoring.js";
import type { ModerationQueues, ModqueueAlerts, MonitorHealth, MonitorStore, WatchedQueue } from "./ports.js";

export interface CheckModqueuePorts {
    readonly openQueues: () => Promise<ModerationQueues>;
    readonly store: MonitorStore;
    readonly alerts: ModqueueAlerts;
    readonly health: MonitorHealth;
}

/** A queue whose size has a threshold: the listing it reads, and the alert it claims. */
type SizeCheck = Readonly<{
    queue: WatchedQueue;
    alert: "queue-size" | "spam-size" | "edited-size";
    read: () => Promise<readonly QueueItem[]>;
    threshold: number;
}>;

function sizeChecks(queues: ModerationQueues, thresholds: MonitorThresholds): readonly SizeCheck[] {
    return [
        { queue: "modqueue", alert: "queue-size", read: queues.modqueue, threshold: thresholds.queueSizeThreshold },
        { queue: "spam", alert: "spam-size", read: queues.spam, threshold: thresholds.spamQueueThreshold },
        { queue: "edited", alert: "edited-size", read: queues.edited, threshold: thresholds.editedQueueThreshold },
    ];
}

/** Reads the queue while its alert is on, and alerts when it is too long: at most once an hour for each queue. */
async function alertIfQueueTooLong(
    { queue, alert, read, threshold }: SizeCheck,
    ports: CheckModqueuePorts,
): Promise<void> {
    if (!isAlertOn(threshold)) {
        return;
    }
    const items = await read();
    if (isQueueTooLong(items.length, threshold) && (await ports.store.claimAlert(alert, ALERT_PERIOD_SECONDS))) {
        await ports.alerts.queueTooLong({ queue, size: items.length, ...countByKind(items), threshold });
    }
}

/** An age limit and the listing it applies to: unmoderated content, or reported content. */
type AgeCheck = Readonly<{ alert: "unmoderated" | "reported"; items: readonly QueueItem[]; ageHours: number }>;

async function alertIfOld({ alert, items, ageHours }: AgeCheck, ports: CheckModqueuePorts): Promise<void> {
    const now = Date.now();
    const old = atLeastHoursOld(items, ageHours, now);
    if (old.length === 0 || !(await ports.store.claimAlert(alert, ALERT_PERIOD_SECONDS))) {
        return;
    }
    const content = { oldest: old.slice(0, OLDEST_ITEMS_LISTED), total: old.length, ageHours, now };
    await (alert === "unmoderated" ? ports.alerts.waitingTooLong(content) : ports.alerts.reportedContentOld(content));
}

async function countFailure(ports: CheckModqueuePorts, errorMessage: string): Promise<void> {
    try {
        const failures = await ports.store.countFailure();
        if (failures < FAILURES_BEFORE_ALERT) {
            await ports.store.expireFailuresAfter(FAILURE_MEMORY_SECONDS);
            return;
        }
        await ports.alerts.monitorFailing({ failures, error: errorMessage });
        await ports.store.clearFailures();
    } catch (trackingError) {
        // The run has already failed, and its condition says so; failing to count it is logged beside that.
        console.warn("[modqueue] Could not count the failed monitor run:", trackingError);
    }
}

/** Clears the failure count after a run that succeeded; a count left behind expires within the hour. */
async function clearFailuresAfterSuccess(store: MonitorStore): Promise<void> {
    await store.clearFailures().catch((error: unknown): void => {
        console.warn("[modqueue] Could not clear the monitor's failure count:", error);
    });
}

/** Reads the listings whose alerts are on and sends the alerts they call for. */
async function checkQueues(
    queues: ModerationQueues,
    thresholds: MonitorThresholds,
    ports: CheckModqueuePorts,
): Promise<void> {
    await Promise.all(
        sizeChecks(queues, thresholds).map(async (check: SizeCheck): Promise<void> => {
            await alertIfQueueTooLong(check, ports);
        }),
    );
    if (isAlertOn(thresholds.unmoderatedAgeHours)) {
        const items = await queues.unmoderated();
        await alertIfOld({ alert: "unmoderated", items, ageHours: thresholds.unmoderatedAgeHours }, ports);
    }
    if (isAlertOn(thresholds.reportedAgeHours)) {
        const items = await queues.reported();
        await alertIfOld({ alert: "reported", items, ageHours: thresholds.reportedAgeHours }, ports);
    }
}

/** A run that succeeded: the failure count clears, and so does the monitor's failing. */
async function succeeded(ports: CheckModqueuePorts): Promise<void> {
    await clearFailuresAfterSuccess(ports.store);
    await ports.health.note("monitor-success", 1);
    await ports.health.clear("monitor-failing");
}

/**
 * One run of the modqueue monitor: alerts when the modqueue, the spam queue or the edited queue is too long, when
 * content has waited unreviewed too long, and when reported content is too old, each at most once an hour. A run that fails, however it fails, is
 * reported as the monitor failing until one succeeds, and is counted: the third failure in a row alerts
 * moderators. A failed run resolves, as Devvit keeps nothing an app can read about a scheduler run that rejects.
 */
export async function checkModqueue(thresholds: MonitorThresholds, ports: CheckModqueuePorts): Promise<void> {
    try {
        await checkQueues(await ports.openQueues(), thresholds, ports);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        await ports.health.note("monitor-failure", 1);
        await ports.health.raise("monitor-failing", reason);
        await countFailure(ports, reason);
        return;
    }
    await succeeded(ports);
}
