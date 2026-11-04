/**
 * Deleted-post alerts: tells moderators when a user deletes their own post after it scored highly, a common
 * way to hide content from moderation. Posts are remembered as they are created and updated, since a deleted
 * post can no longer be read.
 *
 * Owns the Redis keys `post_score:{postId}` (7-day TTL).
 */
export { alertOnUserDeletion, rememberPostScore, type PostDeletionConfig } from './application/postDeletion';
export { postDeletionFromTriggerEvent, seenPostFromTriggerEvent } from './infrastructure/postEvents';
export { createRedisRememberedPosts } from './infrastructure/redisRememberedPosts';
export { createSlackPostDeletionAlerts } from './infrastructure/slackAlerts';
