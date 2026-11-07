import type { TriggerContext } from "@devvit/public-api";

/**
 * When drains of the outbox run: the lease that lets one drain, or one rewrite of the queue, work on it at a time,
 * and the later drains the scheduler runs to continue where one left off or to recover from one that died.
 */

type ScheduleRedis = Readonly<Pick<TriggerContext["redis"], "set" | "del">>;
type ScheduleScheduler = Readonly<Pick<TriggerContext["scheduler"], "runJob">>;
type Scheduling = Readonly<{ redis: ScheduleRedis; scheduler: ScheduleScheduler }>;

/** The scheduler job that delivers what an earlier drain left queued; the composition root registers it. */
export const OUTBOX_JOB_NAME = "slackOutbox";

// Each of these keys expires.
const LEASE_KEY = "slack_outbox_lease";
/** Present while a drain is scheduled to continue where one left off. */
const DRAIN_SCHEDULED_KEY = "slack_outbox_drain_scheduled";
/** Present while a drain is scheduled to follow one that may die before it finishes. */
const RECOVERY_SCHEDULED_KEY = "slack_outbox_recovery_scheduled";

const MS_PER_SECOND = 1000;
/** Slack takes about one message a second to a channel (docs.slack.dev, chat.postMessage, "Rate limiting"). */
export const SEND_INTERVAL_MS = 1100;
/** One drain starts delivering for at most this long, so the trigger or job running it finishes well within its time. */
export const DRAIN_BUDGET_MS = 10_000;
/** Devvit ends an HTTP request after this long (developers.reddit.com/docs, 0.15, HTTP Fetch: "HTTP timeout limit"). */
const FETCH_TIMEOUT_MS = 30_000;
/** The Redis commands a drain makes after its last request. */
const LEASE_MARGIN_MS = 5000;
/**
 * Longer than any drain can hold it: its budget, then a pause before the next message, then a request that runs
 * to the fetch timeout. So a drain never outlives its lease, and letting go of the lease never frees another's; a
 * drain that dies holds the queue for at most this long.
 */
const LEASE_MS = DRAIN_BUDGET_MS + SEND_INTERVAL_MS + FETCH_TIMEOUT_MS + LEASE_MARGIN_MS;

/** A later drain runs this soon after one that used up its time with messages left. */
export const CONTINUE_SOON_MS = 1000;

/** Takes the lease that lets one drain, or one rewrite of the queue, work on it at a time; false when it is held. */
export async function lease({ redis }: Readonly<{ redis: ScheduleRedis }>): Promise<boolean> {
    return (
        (await redis.set(LEASE_KEY, String(Date.now()), {
            nx: true,
            expiration: new Date(Date.now() + LEASE_MS),
        })) !== ""
    );
}

/** Lets go of the lease. */
export async function releaseLease({ redis }: Readonly<{ redis: ScheduleRedis }>): Promise<void> {
    await redis.del(LEASE_KEY);
}

/** Notes that the scheduled continuation is running, so the next drain that must wait can schedule another. */
export async function continuationStarted({ redis }: Readonly<{ redis: ScheduleRedis }>): Promise<void> {
    await redis.del(DRAIN_SCHEDULED_KEY);
}

/**
 * Runs the outbox job at `runAt`, under a claim already taken. A job the scheduler refuses lets go of the claim, so
 * the next drain can schedule one, and rejects.
 */
async function runUnder({ redis, scheduler }: Scheduling, claimKey: string, runAt: Date): Promise<void> {
    try {
        await scheduler.runJob({ name: OUTBOX_JOB_NAME, runAt });
    } catch (error) {
        await redis.del(claimKey);
        throw error;
    }
}

/** Schedules one drain to continue later; a continuation already scheduled covers this one. */
export async function scheduleDrain(scheduling: Scheduling, afterMs: number): Promise<void> {
    const runAt = new Date(Date.now() + afterMs);
    const claimed =
        (await scheduling.redis.set(DRAIN_SCHEDULED_KEY, runAt.toISOString(), {
            nx: true,
            expiration: new Date(runAt.getTime() + LEASE_MS),
        })) !== "";
    if (claimed) {
        await runUnder(scheduling, DRAIN_SCHEDULED_KEY, runAt);
    }
}

/**
 * Schedules a drain for after the current lease has expired, for when the drain holding it dies first: Devvit ends
 * a handler that runs too long, and a Slack request can take up to the fetch timeout. Without it, what that drain
 * left queued would wait for the next alert. A recovery already scheduled covers this one; it expires as its drain
 * runs, so a drain that finds the lease held can schedule the next.
 */
export async function scheduleRecovery(scheduling: Scheduling): Promise<void> {
    const runAt = new Date(Date.now() + LEASE_MS + MS_PER_SECOND);
    const claimed =
        (await scheduling.redis.set(RECOVERY_SCHEDULED_KEY, runAt.toISOString(), { nx: true, expiration: runAt })) !==
        "";
    if (claimed) {
        await runUnder(scheduling, RECOVERY_SCHEDULED_KEY, runAt);
    }
}
