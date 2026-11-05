/**
 * Deleted-post alerts: tells moderators when a user deletes their own post after it scored highly, a common way to
 * hide content from moderation. Votes fire no trigger, so the score is read from Reddit as the post is deleted, and
 * the author's name comes from the deletion event, as the deleted post no longer shows it.
 *
 * Owns the Redis keys `post_deletion:alerted:{postId}` (1-day TTL), which hold nothing but that a deletion was
 * alerted.
 */
export { alertOnUserDeletion, type PostDeletionConfig } from "./application/postDeletion.js";
export { postDeletionFromTriggerEvent, type PostDeleteEvent } from "./infrastructure/postEvents.js";
export { createRedditPostLookup } from "./infrastructure/redditPosts.js";
export { createRedisDeletionClaims } from "./infrastructure/redisDeletionClaims.js";
export { createSlackPostDeletionAlerts } from "./infrastructure/slackAlerts.js";
