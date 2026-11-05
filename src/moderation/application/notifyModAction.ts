import { ACTIVITY_WINDOW_MS, activityOf, activitySpike } from "../domain/activity.js";
import { isReported } from "../domain/alerting.js";
import type { AlertRules } from "../domain/alerting.js";
import { hasBanDurationMetadata, matchBanLogEntry, withBanLogEntry } from "../domain/banDuration.js";
import { disciplineEventOf, disciplineStep, disciplineSubject, liftedBy } from "../domain/discipline.js";
import type { DisciplineEvent } from "../domain/discipline.js";
import { actionTypeOf, isBlank, isRedditAccount } from "../domain/modAction.js";
import type { Actor, ModAction } from "../domain/modAction.js";
import type { ModActionAlerts, ModerationLookups, ModerationRecords } from "./ports.js";

export interface ModerationConfig extends AlertRules {
    /** Send actions by users not on the mod list as security alerts. */
    readonly flagUnknownModerators: boolean;
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
 * Counts the action, at the time it was taken, toward its moderator's activity, noting the spike it completes, if
 * any. Activity tracking is best effort: when storage fails, no spike is noted.
 */
async function withActivity(modAction: ModAction, records: ModerationRecords): Promise<ModAction> {
    const moderator = activityOf(modAction);
    if (moderator === undefined) {
        return modAction;
    }
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
    const { moderatorName } = modAction;
    if (isRedditAccount(moderatorName)) {
        return "reddit";
    }
    return config.flagUnknownModerators &&
        !isBlank(moderatorName) &&
        (await isUnknownModerator(moderatorName, actionTypeOf(modAction), lookups))
        ? "unknown-moderator"
        : "moderator";
}

/**
 * Tells moderators about a mod action. Every action, sent or not, is first completed from the mod log (a ban
 * without a length), remembered or matched against what it lifts (bans and mutes), and counted toward its
 * moderator's activity (except AutoModerator's and Reddit's). Only an action that is reported has its moderator
 * checked against the mod list.
 */
export async function notifyModAction(
    action: ModAction,
    config: ModerationConfig,
    ports: ModerationPorts,
): Promise<void> {
    const modAction = await withActivity(
        await withDiscipline(await withBanFromModLog(action, ports.lookups), ports.records),
        ports.records,
    );
    if (isReported(modAction, config)) {
        await ports.alerts.report(modAction, await actorOf(modAction, config, ports.lookups));
    }
}
