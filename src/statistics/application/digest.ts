import { DIGEST_CRON, DIGEST_DAYS } from "../domain/digest.js";
import type { WeeklyDigest } from "../domain/digest.js";
import { dayRange } from "../domain/report.js";
import type { DigestScheduler, ScheduledDigestJob, StatisticsStore } from "./ports.js";
import { reportFor } from "./teamReport.js";

export interface DigestPorts {
    readonly store: StatisticsStore;
    /** Sends the digest to Slack. */
    readonly send: (digest: WeeklyDigest) => Promise<void>;
}

/**
 * Sends the team's figures for the seven UTC days before `now`'s, beside the week before's total: once however often
 * it is asked to, as a job delivered twice, or two jobs, claim the week first. Rejects when storage fails.
 */
export async function sendWeeklyDigest(ports: DigestPorts, now: number): Promise<void> {
    const days = dayRange(now, DIGEST_DAYS, 1);
    const [from = "", to = ""] = [days[0], days[days.length - 1]];
    if (!(await ports.store.claimDigest(from))) {
        return;
    }
    const report = await reportFor(ports.store, days, now);
    const weekBefore = await reportFor(ports.store, dayRange(now, DIGEST_DAYS, DIGEST_DAYS + 1), now);
    await ports.send({ from, to, report, weekBeforeTotal: weekBefore.actions.total });
    console.info(`[statistics] Sent the weekly statistics for ${from} to ${to}`);
}

/**
 * Leaves one digest job scheduled on DIGEST_CRON, whether or not the digest is on: the job reads the setting when it
 * runs. Keeps the job with the lowest ID, so setups that run at once keep the same one; a second job they both
 * schedule only claims a week already claimed, and the next setup cancels it. Rejects when the scheduler fails.
 */
export async function setUpDigest(scheduler: DigestScheduler): Promise<void> {
    const jobs = await scheduler.jobs();
    const [kept] = jobs
        .filter((job: ScheduledDigestJob): boolean => job.cron === DIGEST_CRON)
        .sort((first: ScheduledDigestJob, second: ScheduledDigestJob): number => first.id.localeCompare(second.id));
    await Promise.all(
        jobs
            .filter((job: ScheduledDigestJob): boolean => job !== kept)
            .map(async (job: ScheduledDigestJob): Promise<void> => {
                await scheduler.cancel(job.id);
            }),
    );
    if (kept === undefined) {
        await scheduler.schedule(DIGEST_CRON);
    }
}
