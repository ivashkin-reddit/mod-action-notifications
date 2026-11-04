import type { TriggerContext } from '@devvit/public-api';
import type { ModerationLookups } from '../application/ports';
import type { BanLogEntry } from '../domain/modAction';

const MOD_LIST_REUSE_MS = 5 * 60 * 1000;
const RECENT_BANS = 10;

/** The subreddit's mod list as last fetched. Create one per app process, so lookups share it. */
export interface ModListCache {
  current: { subreddit: string; fetchedAt: number; moderators: Set<string> } | null;
}

export function createModListCache(): ModListCache {
  return { current: null };
}

export function createRedditModerationLookups(
  reddit: Pick<TriggerContext['reddit'], 'getCurrentSubreddit' | 'getCurrentSubredditName' | 'getModerationLog'>,
  modListCache: ModListCache,
): ModerationLookups {
  return {
    /** Fetches the mod list at most once every five minutes per subreddit. */
    async isModerator(username) {
      const subreddit = await reddit.getCurrentSubreddit();
      const subredditName = subreddit.name ?? 'unknown';
      const normalized = username.toLowerCase();
      const now = Date.now();

      const cached = modListCache.current;
      if (cached && cached.subreddit === subredditName && now - cached.fetchedAt < MOD_LIST_REUSE_MS) {
        return cached.moderators.has(normalized);
      }

      const moderators = await (await subreddit.getModerators()).all();
      const usernames = new Set(moderators.map((moderator) => moderator.username.toLowerCase()));
      modListCache.current = { subreddit: subredditName, fetchedAt: now, moderators: usernames };
      return usernames.has(normalized);
    },

    async recentBans(subredditName): Promise<BanLogEntry[]> {
      const name = subredditName || (await reddit.getCurrentSubredditName());
      if (!name) {
        return [];
      }
      const entries = await reddit.getModerationLog({ subredditName: name, type: 'banuser', limit: RECENT_BANS }).get(RECENT_BANS);
      return (entries ?? []).map((entry) => ({
        id: entry.id,
        moderatorName: entry.moderatorName,
        createdAt: entry.createdAt,
        details: entry.details,
        description: entry.description,
        targetAuthor: entry.target?.author,
      }));
    },
  };
}
