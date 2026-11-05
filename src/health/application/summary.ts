import { dailySummary, SUMMARY_CLAIM_SECONDS, SUMMARY_CRON } from "../domain/summary.js";
import type { DailySummary } from "../domain/summary.js";
import type { ConditionStore, EventStore, ScheduledSummaryJob, SummaryScheduler } from "./ports.js";

export interface SummaryPorts {
    readonly events: EventStore;
    readonly conditions: ConditionStore;
    /** Sends the summary to Slack. */
    readonly send: (summary: DailySummary) => Promise<void>;
}

/**
 * Sends the summary of the UTC day `day`, once however often it is asked to: a job delivered twice, or two summary
 * jobs left by overlapping setups, send it once. Rejects when Redis fails.
 */
export async function sendDailySummary(ports: SummaryPorts, day: string): Promise<void> {
    if (!(await ports.events.claimSummary(day, SUMMARY_CLAIM_SECONDS))) {
        return;
    }
    const summary = dailySummary(day, await ports.events.counts(day), await ports.conditions.inForce());
    await ports.send(summary);
    console.info(`[health] Sent the daily summary for ${day}`);
}

/**
 * Leaves one summary job scheduled on SUMMARY_CRON, whether or not the summary is on: the job reads the setting
 * when it runs. Keeps the job with the lowest ID, so setups that run at once keep the same one; a second job they
 * both schedule only sends a summary already sent, and the next setup cancels it. Rejects when the scheduler fails.
 */
export async function setUpSummary(scheduler: SummaryScheduler): Promise<void> {
    const jobs = await scheduler.jobs();
    const [kept] = jobs
        .filter((job: ScheduledSummaryJob): boolean => job.cron === SUMMARY_CRON)
        .sort((first: ScheduledSummaryJob, second: ScheduledSummaryJob): number => first.id.localeCompare(second.id));
    await Promise.all(
        jobs
            .filter((job: ScheduledSummaryJob): boolean => job !== kept)
            .map(async (job: ScheduledSummaryJob): Promise<void> => {
                await scheduler.cancel(job.id);
            }),
    );
    if (kept === undefined) {
        await scheduler.schedule(SUMMARY_CRON);
    }
}
