import { activitySpike, withActionAt } from "../domain/activity.js";
import { hasBanDurationMetadata, matchBanLogEntry, withBanLogEntry } from "../domain/banDuration.js";
import { disciplineRecordOf, disciplineStep, disciplineSubject } from "../domain/discipline.js";
import type { DisciplineSubject } from "../domain/discipline.js";
import { actionTypeOf, isBlank, isExcludedModerator, moderatorOf } from "../domain/modAction.js";
import type { ModAction, RelatedAction } from "../domain/modAction.js";
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

async function rememberDiscipline(
    subject: DisciplineSubject,
    modAction: ModAction,
    records: ModerationRecords,
): Promise<void> {
    try {
        await records.rememberDiscipline(subject, disciplineRecordOf(modAction));
    } catch {
        // Only the matching unban or unmute loses the reminder.
    }
}

/**
 * The ban or mute the action lifts, forgotten once recalled; undefined when none is remembered or readable. Storage
 * failures only cost the reminder.
 */
async function recallDiscipline(
    subject: DisciplineSubject,
    records: ModerationRecords,
): Promise<RelatedAction | undefined> {
    const remembered = await records.rememberedDiscipline(subject).catch((): undefined => undefined);
    if (remembered === undefined) {
        return undefined;
    }
    await records.forgetDiscipline(subject).catch((): undefined => undefined);
    return remembered ?? undefined;
}

/** Remembers a ban or mute, or attaches the one an unban or unmute lifts. */
async function withDiscipline(modAction: ModAction, records: ModerationRecords): Promise<ModAction> {
    const step = disciplineStep(actionTypeOf(modAction));
    const subject = step === undefined ? undefined : disciplineSubject(step.kind, modAction);
    if (step === undefined || subject === undefined) {
        return modAction;
    }
    if (step.step === "remember") {
        await rememberDiscipline(subject, modAction, records);
        return modAction;
    }
    return { ...modAction, relatedAction: await recallDiscipline(subject, records) };
}

/**
 * Counts the action toward its moderator's activity (except AutoModerator's), noting the spike it completes, if
 * any. Activity tracking is best effort: when the times cannot be read, the action is not counted.
 */
async function withActivity(modAction: ModAction, records: ModerationRecords): Promise<ModAction> {
    if (modAction.isAutoModerator || isBlank(modAction.moderatorName) || isBlank(modAction.subredditName)) {
        return modAction;
    }
    const moderator = { subredditName: modAction.subredditName, moderatorName: modAction.moderatorName };
    const now = Date.now();
    const times = await records
        .recentActionTimes(moderator)
        .then((previousTimes: readonly number[]): readonly number[] => withActionAt(previousTimes, now))
        .catch((): undefined => undefined);
    if (times === undefined) {
        return modAction;
    }
    await records.keepRecentActionTimes(moderator, times).catch((): undefined => undefined);
    return { ...modAction, activitySpike: activitySpike(times) };
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
    const unknownModerator =
        config.flagUnknownModerators &&
        moderatorName !== "Unknown" &&
        (await isUnknownModerator(moderatorName, actionType, lookups));
    if (!config.enableAutoModAlerts && modAction.isAutoModerator) {
        return undefined;
    }
    return { unknownModerator, channel: "" };
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
