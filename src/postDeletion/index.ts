/**
 * Deleted-post alerts: tells moderators when a user deletes their own post after it scored highly, a common way to
 * hide content from moderation. Votes fire no trigger, so the score is read from Reddit as the post is deleted, and
 * the author's name comes from the deletion event, as the deleted post no longer shows it. Keeps nothing in Redis.
 */
export { alertOnUserDeletion, type PostDeletionConfig } from "./application/postDeletion.js";
export { postDeletionFromTriggerEvent, type PostDeleteEvent } from "./infrastructure/postEvents.js";
export { createRedditPostLookup } from "./infrastructure/redditPosts.js";
export { createSlackPostDeletionAlerts } from "./infrastructure/slackAlerts.js";
