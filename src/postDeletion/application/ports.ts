import type { RememberedPost } from '../domain/posts';

export interface RememberedPosts {
  /** Remembers the post for a week, replacing what was remembered about it. */
  remember(post: RememberedPost): Promise<void>;
  /** The remembered post, or undefined. Rejects when what is remembered cannot be read. */
  recall(postId: string): Promise<RememberedPost | undefined>;
  forget(postId: string): Promise<void>;
}

export interface DeletedPostAlert {
  post: RememberedPost;
  subredditName: string;
  /** ISO 8601. */
  deletedAt: string;
  reason: string | number;
}

export interface PostDeletionAlerts {
  highScorePostDeleted(alert: DeletedPostAlert): Promise<void>;
}
