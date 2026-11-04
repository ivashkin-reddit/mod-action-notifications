/**
 * Mod-action alerts: tells moderators in Slack about moderator actions on the subreddit, flags actions by
 * users not on the mod list, bursts of activity by one moderator, and the ban or mute an unban or unmute
 * lifts; and lets moderators send a simulated action.
 *
 * Owns the Redis keys `mod_actions:moderator_activity:{subreddit}:{moderator}` (1-hour TTL) and
 * `mod_actions:discipline:{ban|mute}:{subreddit}:{username}` (90-day TTL).
 */
export { notifyModAction, type ModerationConfig } from './application/notifyModAction';
export { simulateModAction } from './application/simulateModAction';
export { modActionFromTriggerEvent } from './infrastructure/modActionEvent';
export { createRedisModerationRecords } from './infrastructure/redisModerationRecords';
export { createModListCache, createRedditModerationLookups } from './infrastructure/redditModeration';
export { createSlackModActionAlerts, type ModActionPresentation } from './infrastructure/slackModActionAlerts';
export { simulateForm, simulationRequestFromForm } from './infrastructure/simulateForm';
