import type { TriggerContext } from "@devvit/public-api";
import type { ScheduledSummaryJob, SummaryScheduler } from "../application/ports.js";
import { SUMMARY_JOB_NAME } from "../domain/summary.js";

type SummaryJobScheduler = Readonly<Pick<TriggerContext["scheduler"], "runJob" | "cancelJob" | "listJobs">>;
/** What the adapter reads of a listed job: a cron job has a cron, a one-off job a time to run instead. */
type ListedJob = Readonly<{ id: string; name: string; cron?: string }>;

/** The daily summary's jobs on Devvit's scheduler, by the job name main.ts registers. */
export function createDevvitSummaryScheduler(scheduler: SummaryJobScheduler): SummaryScheduler {
    return {
        schedule: async (cron: string): Promise<string> => await scheduler.runJob({ name: SUMMARY_JOB_NAME, cron }),
        cancel: async (jobId: string): Promise<void> => {
            await scheduler.cancelJob(jobId);
        },
        jobs: async (): Promise<readonly ScheduledSummaryJob[]> =>
            (await scheduler.listJobs())
                .filter((job: ListedJob): boolean => job.name === SUMMARY_JOB_NAME)
                .map((job: ListedJob): ScheduledSummaryJob => ({
                    id: job.id,
                    cron: job.cron,
                })),
    };
}
