/**
 * Mod-action alerts: tells moderators in Slack about moderator actions on the subreddit, flags actions by users
 * not on the mod list, bursts of activity by one moderator, and the ban or mute an unban or unmute lifts; summarises
 * a burst of removals by a moderator or one of Reddit's accounts in one message; and lets moderators send a
 * simulated action.
 *
 * Owns the Redis keys `mod_actions:moderator_actions:{subreddit}:{moderator}` (1-hour TTL),
 * `mod_actions:discipline_events:{ban|mute}:{subreddit}:{username}` (90-day TTL) and the burst keys
 * `mod_actions:burst:{subreddit}:{account}`, `mod_actions:burst_closing:…:{due}`, `mod_actions:burst_run:…:{due}` and
 * `mod_actions:burst_rescue:…:{since}` (1-hour TTL); reads, then deletes, the earlier
 * `mod_actions:discipline:{ban|mute}:{subreddit}:{username}`; and owns the scheduler job BURST_JOB_NAME.
 */
export { actionName, ENABLED_ACTIONS_CHOICES } from "./infrastructure/actionCatalog.js";
export { notifyModAction, type ModerationConfig, type ModerationPorts } from "./application/notifyModAction.js";
export { summariseBurst, type BurstPorts } from "./application/bursts.js";
export { BURST_JOB_NAME, burstJobOf, createDevvitBurstSchedule } from "./infrastructure/devvitBurstSchedule.js";
export { createRedisBurstRecords } from "./infrastructure/redisBurstRecords.js";
export type { ModActionAlerts, SimulationAlerts } from "./application/ports.js";
export { isRedditAccount, type ModAction } from "./domain/modAction.js";
export { simulateModAction } from "./application/simulateModAction.js";
export { modActionFromTriggerEvent, type ModActionEvent } from "./infrastructure/modActionEvent.js";
export { createModListCache, createRedditModerationLookups } from "./infrastructure/redditModeration.js";
export { createRedisModerationRecords } from "./infrastructure/redisModerationRecords.js";
export {
    simulateForm,
    simulationRequestFromForm,
    slackChannelFromForm,
    type SimulateFormValues,
} from "./infrastructure/simulateForm.js";
export {
    createSlackModActionAlerts,
    createSlackSimulationAlerts,
    type ModActionPresentation,
} from "./infrastructure/slackModActionAlerts.js";
