import { ACTIVITY_WINDOW_MS, activitySpike } from "../domain/activity.js";
import { hasBanDurationMetadata, matchBanLogEntry, withBanLogEntry } from "../domain/banDuration.js";
import { disciplineEventOf, disciplineStep, disciplineSubject, liftedBy } from "../domain/discipline.js";
import type { DisciplineEvent } from "../domain/discipline.js";
import { actionTypeOf, isBlank, isExcludedModerator, isRedditAccount, moderatorOf } from "../domain/modAction.js";
import type { Actor, ModAction } from "../domain/modAction.js";
import type { ModActionAlerts, ModerationLookups, ModerationRecords, ReportOptions } from "./ports.js";

export interface ModerationConfig {
    /** Whether alerts have somewhere to go; without, mod actions are ignored entirely. */
    readonly alertsConfigured: boolean;
    readonly enabledActions: readonly string[];
    /** Comma-separated usernames whose actions are not sent. */
    readonly excludedModerators: string;
    /** Send actions by users not on the mod list as security alerts. */
    readonly flagUnknownModerators: boolean;
    readonly enableAutoModAlerts: boolean;
}

export interface ModerationPorts {
    readonly records: ModerationRecords;
    readonly lookups: ModerationLookups;
    readonly alerts: ModActionAlerts;
}

/** A ban without a length, completed from the mod log when an entry matches; unchanged otherwise or on failure. */
async function withBanFromModLog(modAction: ModAction, lookups: ModerationLookups): Promise<ModAction> {
    if (modAction.type !== "banuser" || hasBanDurationMetadata(modAction)) {
        return modAction;
    }
    try {
        const entry = matchBanLogEntry(await lookups.recentBans(modAction.subredditName), modAction);
        return entry === undefined ? modAction : withBanLogEntry(modAction, entry);
    } catch {
        // The alert goes out without the length.
        return modAction;
    }
}

/**
 * Records a ban or mute, or its lifting, and attaches to an unban or unmute the ban or mute it lifts. Bans and their
 * unbans can arrive in either order, so the lifted one is found by when each was taken. Storage failures only cost
 * the reminder.
 */
async function withDiscipline(modAction: ModAction, records: ModerationRecords): Promise<ModAction> {
    const step = disciplineStep(actionTypeOf(modAction));
    const subject = step === undefined ? undefined : disciplineSubject(step.kind, modAction);
    if (step === undefined || subject === undefined) {
        return modAction;
    }
    const event = disciplineEventOf(modAction, step.change);
    const relatedAction =
        step.change === "lifted"
            ? liftedBy(await records.disciplineEvents(subject).catch((): readonly DisciplineEvent[] => []), event.at)
            : undefined;
    await records.recordDiscipline(subject, event).catch((): undefined => undefined);
    return step.change === "lifted" ? { ...modAction, relatedAction } : modAction;
}

/**
 * Counts the action, at the time it was taken, toward its moderator's activity (except AutoModerator's and
 * Reddit's, whose bursts are automated), noting the spike it completes, if any. Activity tracking is best effort:
 * when storage fails, no spike is noted.
 */
async function withActivity(modAction: ModAction, records: ModerationRecords): Promise<ModAction> {
    if (
        modAction.isAutoModerator ||
        isRedditAccount(modAction.moderatorName) ||
        isBlank(modAction.moderatorName) ||
        isBlank(modAction.subredditName)
    ) {
        return modAction;
    }
    const moderator = { subredditName: modAction.subredditName, moderatorName: modAction.moderatorName };
    const actionCount = await records
        .countAction(moderator, { id: modAction.id, at: modAction.occurredAt.getTime() }, ACTIVITY_WINDOW_MS)
        .catch((): undefined => undefined);
    return actionCount === undefined ? modAction : { ...modAction, activitySpike: activitySpike(actionCount) };
}

/** Whether the action came from someone not on the mod list; when the list cannot be fetched, assume not. */
async function isUnknownModerator(
    moderatorName: string,
    actionType: string,
    lookups: ModerationLookups,
): Promise<boolean> {
    try {
        if (await lookups.isModerator(moderatorName)) {
            return false;
        }
    } catch (error) {
        console.error("Failed to fetch moderator list:", error);
        return false;
    }
    console.warn("Mod action by unknown moderator", { moderator: moderatorName, action: actionType });
    return true;
}

/**
 * Who took the action: one of Reddit's own accounts, which no mod list includes; else, when unknown moderators are
 * flagged, someone not on the mod list; else a moderator.
 */
async function actorOf(modAction: ModAction, config: ModerationConfig, lookups: ModerationLookups): Promise<Actor> {
    const moderatorName = moderatorOf(modAction);
    if (isRedditAccount(moderatorName)) {
        return "reddit";
    }
    return config.flagUnknownModerators &&
        moderatorName !== "Unknown" &&
        (await isUnknownModerator(moderatorName, actionTypeOf(modAction), lookups))
        ? "unknown-moderator"
        : "moderator";
}

/**
 * How to report the action, or undefined when it is not sent: its type is not enabled, its moderator is excluded,
 * or it is AutoModerator's while AutoModerator alerts are off. Users not on the mod list are checked first.
 */
async function reportOptions(
    modAction: ModAction,
    config: ModerationConfig,
    lookups: ModerationLookups,
): Promise<ReportOptions | undefined> {
    const actionType = actionTypeOf(modAction);
    const moderatorName = moderatorOf(modAction);
    if (!config.enabledActions.includes(actionType) || isExcludedModerator(moderatorName, config.excludedModerators)) {
        return undefined;
    }
    const actor = await actorOf(modAction, config, lookups);
    if (!config.enableAutoModAlerts && modAction.isAutoModerator) {
        return undefined;
    }
    return { actor, channel: "" };
}

/**
 * Tells moderators about a mod action. Every action, sent or not, is first completed from the mod log (a ban
 * without a length), remembered or matched against what it lifts (bans and mutes), and counted toward its
 * moderator's activity (except AutoModerator's).
 */
export async function notifyModAction(
    action: ModAction,
    config: ModerationConfig,
    ports: ModerationPorts,
): Promise<void> {
    if (!config.alertsConfigured) {
        console.error("Slack webhook URL not configured - skipping notification");
        return;
    }
    const modAction = await withActivity(
        await withDiscipline(await withBanFromModLog(action, ports.lookups), ports.records),
        ports.records,
    );
    const options = await reportOptions(modAction, config, ports.lookups);
    if (options !== undefined) {
        await ports.alerts.report(modAction, options);
    }
}
