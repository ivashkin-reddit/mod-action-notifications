import type { TriggerContext } from "@devvit/public-api";
import type { DigestScheduler, ScheduledDigestJob } from "../application/ports.js";
import { DIGEST_JOB_NAME } from "../domain/digest.js";

type DigestJobScheduler = Readonly<Pick<TriggerContext["scheduler"], "runJob" | "cancelJob" | "listJobs">>;
/** What the adapter reads of a listed job: a cron job has a cron, a one-off job a time to run instead. */
type ListedJob = Readonly<{ id: string; name: string; cron?: string }>;

/** The weekly digest's jobs on Devvit's scheduler, by the job name main.ts registers. */
export function createDevvitDigestScheduler(scheduler: DigestJobScheduler): DigestScheduler {
    return {
        schedule: async (cron: string): Promise<string> => await scheduler.runJob({ name: DIGEST_JOB_NAME, cron }),
        cancel: async (jobId: string): Promise<void> => {
            await scheduler.cancelJob(jobId);
        },
        jobs: async (): Promise<readonly ScheduledDigestJob[]> =>
            (await scheduler.listJobs())
                .filter((job: ListedJob): boolean => job.name === DIGEST_JOB_NAME)
                .map((job: ListedJob): ScheduledDigestJob => ({ id: job.id, cron: job.cron })),
    };
}
