import type { TriggerContext } from '@devvit/public-api';
import type { Modqueue } from '../application/ports';

/** Opens the current subreddit's modqueue; rejects when the subreddit cannot be read. */
export async function openRedditModqueue(reddit: Pick<TriggerContext['reddit'], 'getCurrentSubreddit'>): Promise<Modqueue> {
  const subreddit = await reddit.getCurrentSubreddit();
  return {
    async items() {
      const listing = await subreddit.getModQueue({ type: 'all' });
      const items = await listing.all();
      // Posts have a title; comments do not.
      return items.map((item) => ({
        kind: 'title' in item ? 'post' : 'comment',
        createdAt: item.createdAt,
        permalink: item.permalink,
      }));
    },
  };
}
