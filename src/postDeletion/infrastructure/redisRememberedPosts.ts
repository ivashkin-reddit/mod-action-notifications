import type { TriggerContext } from '@devvit/public-api';
import type { RememberedPosts } from '../application/ports';
import type { RememberedPost } from '../domain/posts';

/** Posts older than a week are unlikely to be deleted. */
const RETENTION_SECONDS = 7 * 24 * 60 * 60;

/** Stored under `post_score:{postId}`; installations already hold values in this shape. */
interface StoredPost {
  score: number;
  title: string;
  authorName: string;
  permalink: string;
  subredditName: string;
}

function key(postId: string): string {
  return `post_score:${postId}`;
}

export function createRedisRememberedPosts(redis: Pick<TriggerContext['redis'], 'get' | 'set' | 'del'>): RememberedPosts {
  return {
    async remember(post) {
      const stored: StoredPost = {
        score: post.score,
        title: post.title,
        authorName: post.authorName,
        permalink: post.permalink,
        subredditName: post.subredditName,
      };
      await redis.set(key(post.id), JSON.stringify(stored), {
        expiration: new Date(Date.now() + RETENTION_SECONDS * 1000),
      });
    },
    async recall(postId): Promise<RememberedPost | undefined> {
      const raw = await redis.get(key(postId));
      if (!raw) {
        return undefined;
      }
      const stored = JSON.parse(raw) as StoredPost;
      return {
        id: postId,
        score: stored.score,
        title: stored.title,
        authorName: stored.authorName,
        permalink: stored.permalink,
        subredditName: stored.subredditName,
      };
    },
    async forget(postId) {
      await redis.del(key(postId));
    },
  };
}
