import type { TriggerContext } from '@devvit/public-api';
import type { MonitorStore } from '../application/ports';

// Installations already hold values under these keys.
const MONITOR_JOB_ID_KEY = 'modqueue_monitor_job_id';
const FAILURE_COUNT_KEY = 'scheduler_failure_count';
const throttleKey = (alert: string): string => `mod_actions:throttle:${alert}`;

export function createRedisMonitorStore(
  redis: Pick<TriggerContext['redis'], 'get' | 'set' | 'del' | 'incrBy' | 'expire'>,
): MonitorStore {
  return {
    async claimAlert(alert, periodSeconds) {
      const key = throttleKey(alert);
      if (await redis.get(key)) {
        return false;
      }
      await redis.set(key, Date.now().toString(), { expiration: new Date(Date.now() + periodSeconds * 1000) });
      return true;
    },
    countFailure: () => redis.incrBy(FAILURE_COUNT_KEY, 1),
    async expireFailuresAfter(seconds) {
      await redis.expire(FAILURE_COUNT_KEY, seconds);
    },
    async clearFailures() {
      await redis.del(FAILURE_COUNT_KEY);
    },
    monitorJobId: () => redis.get(MONITOR_JOB_ID_KEY),
    async rememberMonitorJob(jobId) {
      await redis.set(MONITOR_JOB_ID_KEY, jobId);
    },
    async forgetMonitorJob() {
      await redis.del(MONITOR_JOB_ID_KEY);
    },
  };
}
