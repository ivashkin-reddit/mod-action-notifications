import type { TriggerContext } from "@devvit/public-api";
import type { MonitorStore, QueueAlert } from "../application/ports.js";

const MS_PER_SECOND = 1000;

// Installations already hold values under these keys.
const MONITOR_JOB_ID_KEY = "modqueue_monitor_job_id";
const FAILURE_COUNT_KEY = "scheduler_failure_count";
const THROTTLE_KEYS: Readonly<Record<QueueAlert, string>> = {
    "queue-size": "mod_actions:throttle:modqueue_size",
    "unmoderated": "mod_actions:throttle:modqueue_unmoderated",
    "reported": "mod_actions:throttle:modqueue_reported",
};

type MonitorRedis = Readonly<Pick<TriggerContext["redis"], "get" | "set" | "del" | "incrBy" | "expire">>;

export function createRedisMonitorStore(redis: MonitorRedis): MonitorStore {
    return {
        // One atomic SET NX, so monitor runs that overlap cannot both claim the alert. Redis answers an NX set that
        // finds the key with nil, which Devvit returns as "".
        claimAlert: async (alert: QueueAlert, periodSeconds: number): Promise<boolean> =>
            (await redis.set(THROTTLE_KEYS[alert], Date.now().toString(), {
                nx: true,
                expiration: new Date(Date.now() + periodSeconds * MS_PER_SECOND),
            })) !== "",
        countFailure: async (): Promise<number> => await redis.incrBy(FAILURE_COUNT_KEY, 1),
        expireFailuresAfter: async (seconds: number): Promise<void> => {
            await redis.expire(FAILURE_COUNT_KEY, seconds);
        },
        clearFailures: async (): Promise<void> => {
            await redis.del(FAILURE_COUNT_KEY);
        },
        monitorJobId: async (): Promise<string | undefined> => await redis.get(MONITOR_JOB_ID_KEY),
        rememberMonitorJob: async (jobId: string): Promise<void> => {
            await redis.set(MONITOR_JOB_ID_KEY, jobId);
        },
        forgetMonitorJob: async (): Promise<void> => {
            await redis.del(MONITOR_JOB_ID_KEY);
        },
    };
}
