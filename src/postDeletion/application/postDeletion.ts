import { deservesAlert, isWorthRemembering, rememberedPost, type PostDeletion, type SeenPost } from '../domain/posts';
import type { PostDeletionAlerts, RememberedPosts } from './ports';

export interface PostDeletionConfig {
  /** Whether alerts have somewhere to go. */
  alertsConfigured: boolean;
  /** 0 turns deleted-post alerts off. */
  upvoteThreshold: number;
}

/** Remembers a created or updated post whose score makes a deletion alert possible. Never rejects. */
export async function rememberPostScore(
  config: PostDeletionConfig,
  post: SeenPost | undefined,
  posts: RememberedPosts,
): Promise<void> {
  if (config.upvoteThreshold <= 0) {
    return;
  }

  try {
    if (!post?.id || post.score === undefined) {
      return;
    }
    if (!isWorthRemembering(post.score, config.upvoteThreshold)) {
      return;
    }
    await posts.remember(rememberedPost({ ...post, id: post.id, score: post.score }));
  } catch {
    // A post that cannot be remembered only means no alert if it is deleted.
  }
}

/** Alerts moderators when a user deletes a remembered post that had a high score. Never rejects. */
export async function alertOnUserDeletion(
  config: PostDeletionConfig,
  deletion: PostDeletion,
  ports: { posts: RememberedPosts; alerts: PostDeletionAlerts },
): Promise<void> {
  if (config.upvoteThreshold <= 0 || !config.alertsConfigured) {
    return;
  }

  try {
    if (!deletion.postId) {
      console.error('PostDelete event missing postId');
      return;
    }
    if (!deletion.deletedByUser) {
      return;
    }

    const post = await ports.posts.recall(deletion.postId);
    if (!post || !deservesAlert(post, config.upvoteThreshold)) {
      return;
    }

    await ports.alerts.highScorePostDeleted({
      post,
      subredditName: post.subredditName || (deletion.subredditName ?? 'Unknown'),
      deletedAt: deletion.deletedAt ? new Date(deletion.deletedAt).toISOString() : new Date().toISOString(),
      reason: deletion.reason ?? 'Unknown',
    });
    await ports.posts.forget(deletion.postId);
  } catch (error) {
    console.error('Failed to handle post delete:', error);
  }
}
