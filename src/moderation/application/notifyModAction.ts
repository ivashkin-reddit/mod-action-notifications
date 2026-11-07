import { ACTIVITY_WINDOW_MS, activityOf, activitySpike } from "../domain/activity.js";
import { isReported } from "../domain/alerting.js";
import type { AlertRules } from "../domain/alerting.js";
import { hasBanDurationMetadata, matchBanLogEntry, withBanLogEntry } from "../domain/banDuration.js";
import { burstAccountOf, isRemoval } from "../domain/burst.js";
import { disciplineEventOf, disciplineStep, disciplineSubject, isRecorded, liftedBy } from "../domain/discipline.js";
import type { DisciplineEvent } from "../domain/discipline.js";
import { recentHistory } from "../domain/history.js";
import { actionTypeOf, isBlank, isRedditAccount } from "../domain/modAction.js";
import type { Actor, ModAction } from "../domain/modAction.js";
import { joinBurst } from "./bursts.js";
import type { BurstOutcome } from "./bursts.js";
import type { BurstRecords, BurstSchedule, ModActionAlerts, ModerationLookups, ModerationRecords } from "./ports.js";

export interface ModerationConfig extends AlertRules {
    /** Send actions by users not on the mod list as security alerts. */
    readonly flagUnknownModerators: boolean;
    /** How many days of the banned user's mod notes a ban alert counts; 0 leaves them out. */
    readonly banHistoryDays: number;
}

export interface ModerationPorts {
    readonly records: ModerationRecords;
    readonly lookups: ModerationLookups;
    readonly alerts: ModActionAlerts;
    readonly bursts: BurstRecords;
    readonly burstSchedule: BurstSchedule;
}

/** A ban without a length, completed from the mod log when an entry matches; unchanged otherwise or on failure. */
async function withBanFromModLog(modAction: ModAction, lookups: ModerationLookups): Promise<ModAction> {
    if (modAction.type !== "banuser" || hasBanDurationMetadata(modAction)) {
        return modAction;
    }
    try {
        const entry = matchBanLogEntry(await lookups.recentBans(modAction.subredditName), modAction);
        return entry === undefined ? modAction : withBanLogEntry(modAction, entry);
    } catch (error) {
        console.warn("[modaction] Could not read the mod log for a ban's length, so alerting without it:", error);
        return modAction;
    }
}

/**
 * Records a ban or mute, or its lifting, and attaches to an unban or unmute the ban or mute it lifts: only while
 * alerts for their lifting are on, as nothing else reads the record. Bans and their unbans can arrive in either
 * order, so the lifted one is found by when each was taken. Storage failures only cost the reminder.
 */
async function withDiscipline(
    modAction: ModAction,
    enabledActions: readonly string[],
    records: ModerationRecords,
): Promise<ModAction> {
    const step = disciplineStep(actionTypeOf(modAction));
    const subject = step === undefined ? undefined : disciplineSubject(step.kind, modAction);
    if (step === undefined || subject === undefined || !isRecorded(step.kind, enabledActions)) {
        return modAction;
    }
    const event = disciplineEventOf(modAction, step.change);
    const relatedAction =
        step.change === "lifted"
            ? liftedBy(
                  await records.disciplineEvents(subject).catch((error: unknown): readonly DisciplineEvent[] => {
                      console.warn(
                          "[modaction] Could not read the user's bans and mutes, so alerting without the one lifted:",
                          error,
                      );
                      return [];
                  }),
                  event.at,
              )
            : undefined;
    await records.recordDiscipline(subject, event).catch((error: unknown): void => {
        console.warn("[modaction] Could not record a ban or mute, so a later unban or unmute will not name it:", error);
    });
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
        .catch((error: unknown): undefined => {
            console.warn(
                "[modaction] Could not count the moderator's action, so alerting without spike detection:",
                error,
            );
            return undefined;
        });
    return actionCount === undefined ? modAction : { ...modAction, activitySpike: activitySpike(actionCount) };
}

/** A ban, with what the user's mod notes record in the configured days before it; unchanged when off, or on failure. */
async function withRecentHistory(modAction: ModAction, days: number, lookups: ModerationLookups): Promise<ModAction> {
    const username = modAction.target?.author;
    if (actionTypeOf(modAction) !== "banuser" || days === 0 || isBlank(username)) {
        return modAction;
    }
    try {
        const notes = await lookups.modNotes(modAction.subredditName, username);
        return { ...modAction, recentHistory: recentHistory(notes, modAction.occurredAt, days) };
    } catch (error) {
        console.warn(
            "[modaction] Could not read the user's mod notes, so alerting the ban without their history:",
            error,
        );
        return modAction;
    }
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
        console.warn("[modaction] Could not fetch the mod list, so treating the action as a moderator's:", error);
        return false;
    }
    // The alert names the account, for the moderators; the log, for the developer, does not.
    console.warn("[modaction] An account not on the mod list took an action, alerted as a security alert", {
        action: actionType,
    });
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
 * Whether this delivery of the action is the first, so the one to report: Devvit can deliver an event more than
 * once. An action without an ID cannot be told apart from another, and is reported; so is one whose claim cannot be
 * stored, as a second alert is better than none.
 */
async function isFirstDelivery(modAction: ModAction, records: ModerationRecords): Promise<boolean> {
    if (isBlank(modAction.id)) {
        return true;
    }
    return await records.claimReport(modAction.id).catch((error: unknown): boolean => {
        console.warn("[modaction] Could not record that the action was alerted, so it may be alerted again:", error);
        return true;
    });
}

/** What becomes of the action: a removal at the spike rate joins its account's burst; anything else goes on its own. */
async function burstOutcome(modAction: ModAction, actor: Actor, ports: ModerationPorts): Promise<BurstOutcome> {
    const account = burstAccountOf(modAction, actor);
    const type = actionTypeOf(modAction);
    return account === undefined || !isRemoval(type)
        ? "alone"
        : await joinBurst({ account, type, at: Date.now() }, ports);
}

/**
 * Tells moderators about a mod action. Every action, sent or not, is first completed from the mod log (a ban
 * without a length), remembered or matched against what it lifts (bans and mutes, while alerts for their lifting
 * are on), and counted toward its account's activity (except AutoModerator's). Only an action that is reported has
 * its moderator checked against the mod list, and an action delivered again is reported once. A removal at the spike
 * rate, by a moderator or one of Reddit's accounts, joins its account's burst: the first is alerted, saying further
 * removals will be summarised, and the rest are held for the summary. Returns the action as completed, for what else
 * counts it.
 */
export async function notifyModAction(
    action: ModAction,
    config: ModerationConfig,
    ports: ModerationPorts,
): Promise<ModAction> {
    const modAction = await withActivity(
        await withDiscipline(await withBanFromModLog(action, ports.lookups), config.enabledActions, ports.records),
        ports.records,
    );
    if (!isReported(modAction, config)) {
        return modAction;
    }
    const actor = await actorOf(modAction, config, ports.lookups);
    // Claimed just before the alert is queued, so a delivery that fails earlier leaves the report to the next one, and
    // a removal delivered again is counted in its burst once.
    if (!(await isFirstDelivery(modAction, ports.records))) {
        return modAction;
    }
    const outcome = await burstOutcome(modAction, actor, ports);
    if (outcome !== "held") {
        await ports.alerts.report(
            await withRecentHistory(modAction, config.banHistoryDays, ports.lookups),
            actor,
            outcome === "opened",
        );
    }
    return modAction;
}
