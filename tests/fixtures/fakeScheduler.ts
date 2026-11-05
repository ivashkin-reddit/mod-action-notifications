import { vi } from "vitest";
import type { Mock } from "vitest";

/** A scheduled job: a cron job, or a one-off job due at `runAt`. */
export interface ScheduledJob {
    readonly id: string;
    readonly name: string;
    readonly cron?: string;
    readonly runAt?: Date;
}

type JobOptions = Readonly<{ name: string; cron?: string; runAt?: Date }>;

export interface FakeScheduler {
    jobs: readonly ScheduledJob[];
    readonly runJob: Mock<(job: JobOptions) => Promise<string>>;
    readonly cancelJob: Mock<(id: string) => Promise<void>>;
    readonly listJobs: Mock<() => Promise<readonly ScheduledJob[]>>;
}

export function createFakeScheduler(): FakeScheduler {
    const scheduler: Pick<FakeScheduler, "jobs"> = { jobs: [] };
    let nextId = 1;
    return Object.assign(scheduler, {
        runJob: vi.fn(async ({ name, cron, runAt }: JobOptions): Promise<string> => {
            const id = `job-${String(nextId)}`;
            nextId += 1;
            scheduler.jobs = [
                ...scheduler.jobs,
                { id, name, ...(cron === undefined ? {} : { cron }), ...(runAt === undefined ? {} : { runAt }) },
            ];
            return await Promise.resolve(id);
        }),
        cancelJob: vi.fn(async (id: string): Promise<void> => {
            scheduler.jobs = scheduler.jobs.filter((job: ScheduledJob): boolean => job.id !== id);
            await Promise.resolve();
        }),
        listJobs: vi.fn(async (): Promise<readonly ScheduledJob[]> => await Promise.resolve(scheduler.jobs)),
    });
}
