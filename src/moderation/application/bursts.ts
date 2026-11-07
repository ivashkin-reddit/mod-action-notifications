import type { ModeratorRef } from "../domain/activity.js";
import {
    BURST_QUIET_MS,
    BURST_RESCUE_DELAY_MS,
    burstActorOf,
    burstStep,
    heldAny,
    isOverdue,
    tallyOf,
} from "../domain/burst.js";
import type { Burst, BurstSummary, RemovalType } from "../domain/burst.js";
import type { BurstJoin, BurstRecords, BurstSchedule, ModActionAlerts } from "./ports.js";

/** What bursts of removals need: where they are kept, when their summaries run, and where summaries go. */
export interface BurstPorts {
    readonly bursts: BurstRecords;
    readonly burstSchedule: BurstSchedule;
    readonly alerts: Pick<ModActionAlerts, "reportBurst">;
}

/** A removal at the spike rate: its account, its type, and when the app handled it, in ms since the epoch. */
export type BurstRemoval = Readonly<{ account: ModeratorRef; type: RemovalType; at: number }>;

/** One scheduled run of a burst's summary: its account, when it was due (which names the run), and now. */
export type BurstRun = Readonly<{ account: ModeratorRef; due: number; now: number }>;

/** What became of a removal at the spike rate: it opened a burst, joined one, or goes out on its own. */
export type BurstOutcome = "opened" | "held" | "alone";

/** A burst that goes on, and what its run does: send progress or not, and run next at `nextDue`. */
type GoingOn = Readonly<{ burst: Burst; progress: boolean; nextDue: number }>;

/**
 * Schedules the summary of a burst just opened, a quiet minute on. One that cannot be scheduled is forgotten, so its
 * removals are alerted one by one: a burst with nothing to end it would hold them unseen.
 */
async function scheduleOpened({ account, at }: BurstRemoval, ports: BurstPorts): Promise<BurstOutcome> {
    const due = at + BURST_QUIET_MS;
    try {
        // The due time first: the run, which may start at once, then finds its own in the burst.
        await ports.bursts.setDue(account, due);
        await ports.burstSchedule.summariseAt(account, due);
        return "opened";
    } catch (error) {
        console.warn("[burst] Could not schedule a burst's summary, so alerting its removals one by one:", error);
        await ports.bursts.discard(account).catch((discardError: unknown): void => {
            console.warn("[burst] Could not forget a burst it could not schedule:", discardError);
        });
        return "alone";
    }
}

/**
 * Schedules again a summary whose run was lost: overdue, as the run reschedules itself or closes the burst. One
 * removal claims the rescue, so a run of removals schedules it once. A rescue that fails leaves it overdue, for the
 * next removal to try.
 */
async function rescueIfOverdue({ account, at }: BurstRemoval, joined: BurstJoin, ports: BurstPorts): Promise<void> {
    if (!isOverdue({ due: joined.due, opened: joined.openedAt }, at)) {
        return;
    }
    try {
        if (!(await ports.bursts.claimRescue(account, joined.due ?? joined.openedAt))) {
            return;
        }
        const due = at + BURST_RESCUE_DELAY_MS;
        await ports.bursts.setDue(account, due);
        await ports.burstSchedule.summariseAt(account, due);
    } catch (error) {
        console.warn("[burst] Could not schedule an overdue burst summary again:", error);
    }
}

/**
 * Counts a removal at the spike rate in its account's burst: the first opens the burst and schedules its summary, and
 * is alerted, saying so; the rest are held for the summary. A removal that cannot be counted is alerted on its own.
 */
export async function joinBurst(removal: BurstRemoval, ports: BurstPorts): Promise<BurstOutcome> {
    const joined = await ports.bursts
        .join(removal.account, removal.type, removal.at)
        .catch((error: unknown): undefined => {
            console.warn("[burst] Could not count a removal in its burst, so alerting it on its own:", error);
            return undefined;
        });
    if (joined === undefined) {
        return "alone";
    }
    if (joined.opened) {
        return await scheduleOpened(removal, ports);
    }
    await rescueIfOverdue(removal, joined, ports);
    return "held";
}

function summaryOf(account: ModeratorRef, burst: Burst, final: boolean): BurstSummary {
    return {
        account,
        actor: burstActorOf(account),
        tally: tallyOf(burst.counts),
        opened: burst.opened,
        last: burst.last,
        final,
    };
}

/** Closes the burst and sends its total, unless only the removal that opened it was counted: its alert said that. */
async function closeBurst({ account, due }: BurstRun, ports: BurstPorts): Promise<void> {
    const closed = await ports.bursts.close(account, due);
    if (closed !== undefined && heldAny(closed.counts)) {
        await ports.alerts.reportBurst(summaryOf(account, closed, true));
    }
}

/**
 * Lets the burst go on: its running totals when progress is due, then the next run. A run that cannot schedule the
 * next closes the burst, as nothing else would.
 */
async function continueBurst(run: BurstRun, { burst, progress, nextDue }: GoingOn, ports: BurstPorts): Promise<void> {
    if (progress) {
        await ports.alerts.reportBurst(summaryOf(run.account, burst, false));
        await ports.bursts.noteProgress(run.account, run.now);
    }
    try {
        await ports.bursts.setDue(run.account, nextDue);
        await ports.burstSchedule.summariseAt(run.account, nextDue);
    } catch (error) {
        console.warn("[burst] Could not schedule a burst's next summary, so closing it now:", error);
        await closeBurst(run, ports);
    }
}

/**
 * The burst this run is for: undefined when the scheduler delivered the run already, the burst has closed, or a later
 * run or a rescue has taken it over.
 */
async function burstOfRun({ account, due }: BurstRun, ports: BurstPorts): Promise<Burst | undefined> {
    if (!(await ports.bursts.claimRun(account, due))) {
        return undefined;
    }
    const burst = await ports.bursts.read(account);
    return burst === undefined || (burst.due !== undefined && burst.due !== due) ? undefined : burst;
}

/**
 * One scheduled run of a burst's summary. A burst quiet for a minute is closed and its total sent; one that goes on
 * sends its running totals every five minutes and runs again. Rejects when Redis fails; the job logs it.
 */
export async function summariseBurst(run: BurstRun, ports: BurstPorts): Promise<void> {
    const burst = await burstOfRun(run, ports);
    if (burst === undefined) {
        return;
    }
    const step = burstStep(burst, run.now);
    await (step.kind === "close"
        ? closeBurst(run, ports)
        : continueBurst(run, { burst, progress: step.progress, nextDue: step.nextDue }, ports));
}
