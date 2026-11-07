import type { TriggerContext } from "@devvit/public-api";
import type { BurstSchedule } from "../application/ports.js";
import type { ModeratorRef } from "../domain/activity.js";

/** The scheduler job that sends a burst's summaries; the composition root registers it. Installations schedule it. */
export const BURST_JOB_NAME = "removalBurst";

/** What a burst's job carries: its account, and when it is due, which names the run. */
export type BurstJob = Readonly<{ account: ModeratorRef; due: number }>;

type BurstScheduler = Readonly<Pick<TriggerContext["scheduler"], "runJob">>;

/** Schedules a burst's summary as a one-off job, carrying its account and due time. */
export function createDevvitBurstSchedule(scheduler: BurstScheduler): BurstSchedule {
    return {
        summariseAt: async ({ subredditName, moderatorName }: ModeratorRef, due: number): Promise<void> => {
            await scheduler.runJob({
                name: BURST_JOB_NAME,
                runAt: new Date(due),
                data: { subredditName, moderatorName, due },
            });
        },
    };
}

function field(data: object, name: string): unknown {
    return Object.entries(data).find(([key]: readonly [string, unknown]): boolean => key === name)?.[1];
}

/** The burst a job's event names, in the data it was scheduled with; undefined for one this app did not schedule. */
export function burstJobOf(event: unknown): BurstJob | undefined {
    const data = typeof event === "object" && event !== null ? field(event, "data") : undefined;
    if (typeof data !== "object" || data === null) {
        return undefined;
    }
    const [subredditName, moderatorName, due] = ["subredditName", "moderatorName", "due"].map((name: string): unknown =>
        field(data, name),
    );
    if (typeof subredditName !== "string" || typeof moderatorName !== "string" || typeof due !== "number") {
        return undefined;
    }
    return { account: { subredditName, moderatorName }, due };
}
