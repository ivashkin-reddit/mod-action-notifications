/**
 * Mod-action alerts: tells moderators in Slack about moderator actions on the subreddit, flags actions by users
 * not on the mod list, bursts of activity by one moderator, and the ban or mute an unban or unmute lifts; and lets
 * moderators send a simulated action.
 *
 * Owns the Redis keys `mod_actions:moderator_actions:{subreddit}:{moderator}` (1-hour TTL) and
 * `mod_actions:discipline_events:{ban|mute}:{subreddit}:{username}` (90-day TTL), and reads, then deletes, the
 * earlier `mod_actions:discipline:{ban|mute}:{subreddit}:{username}`.
 */
export { actionName, ENABLED_ACTIONS_CHOICES } from "./infrastructure/actionCatalog.js";
export { notifyModAction, type ModerationConfig, type ModerationPorts } from "./application/notifyModAction.js";
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
