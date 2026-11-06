import {
    daysDormant,
    isAutoModeratorRemoval,
    isEditBy,
    lineChanges,
    misfireAfter,
    misfireMinutes,
} from "../domain/watch.js";
import type { ConfigEdit, WatchedAction } from "../domain/watch.js";
import type { ConfigWiki, SecurityAlerts, SecurityStore } from "./ports.js";

export interface SecurityConfig {
    /** The Security Alerts setting: the watch alerts only while it is on. */
    readonly securityAlerts: boolean;
    /** A moderator's first action after this many days alerts; 0 turns it off. */
    readonly dormantModeratorDays: number;
    /** Whether Slack is set up, so alerts can go. */
    readonly alertsReady: boolean;
}

export interface SecurityPorts {
    readonly store: SecurityStore;
    readonly wiki: ConfigWiki;
    readonly alerts: SecurityAlerts;
}

function alertsOn(config: SecurityConfig): boolean {
    return config.securityAlerts && config.alertsReady;
}

/**
 * Forgets a moderator removed from the team: their silence no longer counts. True when they removed themselves, as
 * a moderator leaving does, so their own action is not noted for them again.
 */
async function forgetRemoved(action: WatchedAction, store: SecurityStore): Promise<boolean> {
    const removed = action.targetName?.toLowerCase() ?? "";
    if (action.type !== "removemoderator" || removed === "") {
        return false;
    }
    await store.forgetModerator(removed);
    return removed === action.moderatorName?.toLowerCase();
}

/**
 * Notes that the moderator acted at `at`, unless they already acted later, and returns when they last acted before.
 * A read, then a write, against the rule of single atomic commands, and still safe: the alert this informs is claimed
 * atomically, so actions handled at once alert once, and a late, older action never moves a moderator's time back.
 */
async function swapLastAction(moderator: string, at: number, store: SecurityStore): Promise<number | undefined> {
    const lastAt = await store.lastAction(moderator);
    if (lastAt === undefined || at > lastAt) {
        await store.noteAction(moderator, at);
    }
    return lastAt;
}

/** Keeps when each moderator last acted, and alerts once on one's first action after the configured days. */
async function watchModerator(action: WatchedAction, config: SecurityConfig, ports: SecurityPorts): Promise<void> {
    const name = action.moderatorName ?? "";
    if (action.actor !== "moderator" || name === "") {
        return;
    }
    if (await forgetRemoved(action, ports.store)) {
        return;
    }
    const moderator = name.toLowerCase();
    const lastAt = await swapLastAction(moderator, action.occurredAt.getTime(), ports.store);
    const days = alertsOn(config)
        ? daysDormant(lastAt, action.occurredAt.getTime(), config.dormantModeratorDays)
        : undefined;
    if (lastAt !== undefined && days !== undefined && (await ports.store.claimWake(moderator))) {
        await ports.alerts.moderatorWoke({ moderator: name, days, lastAt, type: action.type });
    }
}

/** The config's change if its latest revision is this action's: which, why, and lines added and removed. */
async function configChange(
    action: WatchedAction,
    wiki: ConfigWiki,
): Promise<Readonly<{ revisionId: string; reason: string; added: number; removed: number }> | undefined> {
    const [latest, previous] = await wiki.latestRevisions(action.subredditName);
    if (latest === undefined || !isEditBy(latest, action)) {
        return undefined;
    }
    const after = await wiki.revisionText(action.subredditName, latest.id);
    const before = previous === undefined ? "" : await wiki.revisionText(action.subredditName, previous.id);
    return { revisionId: latest.id, reason: latest.reason, ...lineChanges(before, after) };
}

/**
 * On a wiki edit, checks whether it was to AutoModerator's config; if so, notes it and alerts, once for the revision:
 * a wiki edit delivered again, or the same moderator's edit to another page just after, finds the same revision.
 */
async function watchConfig(action: WatchedAction, config: SecurityConfig, ports: SecurityPorts): Promise<void> {
    const name = action.moderatorName ?? "";
    if (!config.securityAlerts || action.type !== "wikirevise" || action.actor !== "moderator" || name === "") {
        return;
    }
    const change = await configChange(action, ports.wiki).catch((error: unknown): undefined => {
        console.warn("[security] Could not read AutoModerator's config, so a wiki edit was not checked:", error);
        return undefined;
    });
    if (change === undefined || !(await ports.store.claimConfigEdit(change.revisionId))) {
        return;
    }
    await ports.store.noteConfigEdit({ at: action.occurredAt.getTime(), by: name });
    if (config.alertsReady) {
        await ports.alerts.configEdited({
            moderator: name,
            reason: change.reason,
            added: change.added,
            removed: change.removed,
            subredditName: action.subredditName,
        });
    }
}

/** Alerts once if AutoModerator's removals since the edit look like a misfire. */
async function checkMisfire(action: WatchedAction, edit: ConfigEdit, ports: SecurityPorts): Promise<void> {
    const { from, to } = misfireMinutes(edit.at);
    const misfire = misfireAfter(await ports.store.autoModRemovals(from, to), edit.at, action.occurredAt.getTime());
    if (misfire !== undefined && (await ports.store.claimMisfire(edit.at))) {
        await ports.alerts.misfiring({
            editor: edit.by,
            removals: misfire.sinceEdit,
            hourlyAverage: misfire.hourlyAverage,
            subredditName: action.subredditName,
        });
    }
}

/** Counts AutoModerator's removals, and checks for a misfire after a recent edit to its config. */
async function watchAutoModerator(action: WatchedAction, config: SecurityConfig, ports: SecurityPorts): Promise<void> {
    if (!isAutoModeratorRemoval(action)) {
        return;
    }
    await ports.store.countAutoModRemoval(action.occurredAt.getTime());
    const edit = alertsOn(config) ? await ports.store.lastConfigEdit() : undefined;
    if (edit !== undefined) {
        await checkMisfire(action, edit, ports);
    }
}

/**
 * Watches a mod action for signs of a compromised account or a broken tool: a moderator acting after a long silence,
 * an edit to AutoModerator's config, and AutoModerator removing far more than usual after one. Rejects when storage
 * fails; a wiki that cannot be read is logged.
 */
export async function watchModAction(
    action: WatchedAction,
    config: SecurityConfig,
    ports: SecurityPorts,
): Promise<void> {
    await watchModerator(action, config, ports);
    await watchConfig(action, config, ports);
    await watchAutoModerator(action, config, ports);
}
