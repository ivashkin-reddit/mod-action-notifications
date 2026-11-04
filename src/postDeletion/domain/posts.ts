/** A post the app has seen created or updated. Fields Devvit did not provide are missing. */
export interface SeenPost {
  id?: string;
  score?: number;
  title?: string;
  authorName?: string;
  permalink?: string;
  subredditName?: string;
}

/** A post remembered so that its deletion can be alerted on. */
export interface RememberedPost {
  id: string;
  score: number;
  title: string;
  authorName: string;
  permalink: string;
  subredditName: string;
}

/** A post being deleted. */
export interface PostDeletion {
  postId?: string;
  /** Deleted by its author, as opposed to by a moderator or an admin. */
  deletedByUser: boolean;
  deletedAt?: Date | string;
  /** Reddit's deletion reason, as Devvit gives it. */
  reason?: string | number;
  subredditName?: string;
}

/**
 * A post is remembered once its score reaches half the alert threshold, so posts that go on to reach the
 * threshold are already known when they are deleted, without remembering every post.
 */
export function isWorthRemembering(score: number, upvoteThreshold: number): boolean {
  return score >= upvoteThreshold * 0.5;
}

/** A user deleting a post alerts moderators when the post had at least the threshold score. */
export function deservesAlert(post: RememberedPost, upvoteThreshold: number): boolean {
  return post.score >= upvoteThreshold;
}

/** What a seen post is remembered as, filling in what Devvit did not provide. */
export function rememberedPost(post: SeenPost & { id: string; score: number }): RememberedPost {
  return {
    id: post.id,
    score: post.score,
    title: post.title ?? 'Untitled',
    authorName: post.authorName ?? 'Unknown',
    permalink: post.permalink ?? '',
    subredditName: post.subredditName ?? 'Unknown',
  };
}
