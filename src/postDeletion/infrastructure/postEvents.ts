import type { PostDeletion, SeenPost } from '../domain/posts';

/** EventSource.USER in @devvit/protos: the post's author deleted it. */
const EVENT_SOURCE_USER = 1;

/**
 * The post in a PostCreate or PostUpdate trigger event. Devvit's post has authorId and subredditId but no
 * authorName or subredditName, so those are always missing.
 */
export function seenPostFromTriggerEvent(event: Record<string, unknown>): SeenPost | undefined {
  const post = event.post as Record<string, unknown> | undefined;
  if (!post) {
    return undefined;
  }
  return {
    id: post.id as string | undefined,
    score: post.score as number | undefined,
    title: post.title as string | undefined,
    authorName: post.authorName as string | undefined,
    permalink: post.permalink as string | undefined,
    subredditName: post.subredditName as string | undefined,
  };
}

/** The deletion in a PostDelete trigger event. */
export function postDeletionFromTriggerEvent(event: Record<string, unknown>): PostDeletion {
  const subreddit = event.subreddit as Record<string, unknown> | undefined;
  return {
    postId: event.postId as string | undefined,
    deletedByUser: (event.source as number | undefined) === EVENT_SOURCE_USER,
    deletedAt: event.deletedAt as Date | string | undefined,
    reason: event.reason as string | number | undefined,
    subredditName: subreddit?.name as string | undefined,
  };
}
