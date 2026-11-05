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
import type { ModerationQueues, ModqueueAlerts, MonitorStore } from "./ports.js";

export interface CheckModqueuePorts {
    readonly openQueues: () => Promise<ModerationQueues>;
    readonly store: MonitorStore;
    readonly alerts: ModqueueAlerts;
}

async function alertIfQueueTooLong(
    items: readonly QueueItem[],
    thresholds: MonitorThresholds,
    ports: CheckModqueuePorts,
): Promise<void> {
    if (
        isQueueTooLong(items.length, thresholds.queueSizeThreshold) &&
        (await ports.store.claimAlert("queue-size", ALERT_PERIOD_SECONDS))
    ) {
        await ports.alerts.queueTooLong({
            size: items.length,
            ...countByKind(items),
            threshold: thresholds.queueSizeThreshold,
        });
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

async function countFailure(ports: CheckModqueuePorts, error: Readonly<Error>): Promise<void> {
    try {
        const failures = await ports.store.countFailure();
        if (failures < FAILURES_BEFORE_ALERT) {
            await ports.store.expireFailuresAfter(FAILURE_MEMORY_SECONDS);
            return;
        }
        await ports.alerts.monitorFailing({ failures, error: error.message });
        await ports.store.clearFailures();
    } catch {
        // Failure tracking must not break the scheduler.
        console.error("Failed to track scheduler failures");
    }
}

/**
 * Reads the listings whose alerts are on and sends the alerts they call for; a successful run clears the failure
 * count.
 */
async function checkQueues(
    queues: ModerationQueues,
    thresholds: MonitorThresholds,
    ports: CheckModqueuePorts,
): Promise<void> {
    if (isAlertOn(thresholds.queueSizeThreshold)) {
        await alertIfQueueTooLong(await queues.modqueue(), thresholds, ports);
    }
    if (isAlertOn(thresholds.unmoderatedAgeHours)) {
        const items = await queues.unmoderated();
        await alertIfOld({ alert: "unmoderated", items, ageHours: thresholds.unmoderatedAgeHours }, ports);
    }
    if (isAlertOn(thresholds.reportedAgeHours)) {
        const items = await queues.reported();
        await alertIfOld({ alert: "reported", items, ageHours: thresholds.reportedAgeHours }, ports);
    }
    try {
        await ports.store.clearFailures();
    } catch {
        // A stale failure count expires within the hour.
    }
}

/**
 * One run of the modqueue monitor: alerts when the modqueue is too long, when content has waited unreviewed too
 * long, and when reported content is too old, each at most once an hour. A run that fails to read a listing is
 * counted, and the third failure in a row alerts moderators; the run then rejects so the scheduler records the
 * failure. Failing to open the subreddit at all rejects without being counted.
 */
export async function checkModqueue(thresholds: MonitorThresholds, ports: CheckModqueuePorts): Promise<void> {
    const queues = await ports.openQueues();

    try {
        await checkQueues(queues, thresholds, ports);
    } catch (error) {
        console.error("Failed to check modqueue:", error);
        if (error instanceof Error) {
            await countFailure(ports, error);
        }
        throw error;
    }
}
