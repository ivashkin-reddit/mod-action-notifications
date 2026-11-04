import type { TriggerContext } from '@devvit/public-api';
import type { ModerationRecords } from '../application/ports';
import type { DisciplineKind, RelatedAction } from '../domain/modAction';

const ACTIVITY_RETENTION_SECONDS = 60 * 60;
const DISCIPLINE_RETENTION_SECONDS = 90 * 24 * 60 * 60;

// Installations already hold values under these keys, in these shapes.
const keyPart = (value: string): string => value.toLowerCase().replace(/[:\s]/g, '_');
const activityKey = (subredditName: string, moderatorName: string): string =>
  `mod_actions:moderator_activity:${keyPart(subredditName)}:${keyPart(moderatorName)}`;
const disciplineKey = (kind: DisciplineKind, subredditName: string, username: string): string =>
  `mod_actions:discipline:${kind}:${keyPart(subredditName)}:${keyPart(username)}`;

interface StoredDiscipline {
  type?: string;
  moderatorName?: string;
  timestamp?: number;
  description?: string | null;
  details?: string | null;
}

export function createRedisModerationRecords(redis: Pick<TriggerContext['redis'], 'get' | 'set' | 'del'>): ModerationRecords {
  const expiringIn = (seconds: number) => ({ expiration: new Date(Date.now() + seconds * 1000) });

  return {
    async recentActionTimes(subredditName, moderatorName) {
      const raw = await redis.get(activityKey(subredditName, moderatorName));
      if (!raw) {
        return [];
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : [];
      } catch {
        return [];
      }
    },

    async keepRecentActionTimes(subredditName, moderatorName, times) {
      await redis.set(activityKey(subredditName, moderatorName), JSON.stringify(times), expiringIn(ACTIVITY_RETENTION_SECONDS));
    },

    async rememberDiscipline(kind, subredditName, username, record) {
      const stored: StoredDiscipline = {
        type: kind,
        moderatorName: record.moderatorName,
        timestamp: record.occurredAt,
        description: record.description,
        details: record.details,
      };
      await redis.set(disciplineKey(kind, subredditName, username), JSON.stringify(stored), expiringIn(DISCIPLINE_RETENTION_SECONDS));
    },

    async rememberedDiscipline(kind, subredditName, username): Promise<RelatedAction | null | undefined> {
      const raw = await redis.get(disciplineKey(kind, subredditName, username));
      if (!raw) {
        return undefined;
      }
      try {
        const stored = JSON.parse(raw) as StoredDiscipline | null;
        return {
          type: stored?.type === 'mute' ? 'muteuser' : 'banuser',
          moderatorName: stored?.moderatorName ?? undefined,
          occurredAt: stored?.timestamp ? new Date(stored.timestamp) : undefined,
          description: stored?.description ?? undefined,
          details: stored?.details ?? undefined,
        };
      } catch {
        return null;
      }
    },

    async forgetDiscipline(kind, subredditName, username) {
      await redis.del(disciplineKey(kind, subredditName, username));
    },
  };
}
