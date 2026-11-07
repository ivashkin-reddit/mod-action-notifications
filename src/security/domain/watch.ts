/** Who took an action, as the security watch tells them apart. */
export type WatchedActor = "moderator" | "automoderator" | "reddit";

/** A mod action, as the security watch sees it. */
export interface WatchedAction {
    readonly type: string;
    readonly moderatorName: string | undefined;
    readonly actor: WatchedActor;
    readonly occurredAt: Date;
    readonly subredditName: string | undefined;
    /** The user the action was on: for removemoderator, the moderator removed. */
    readonly targetName: string | undefined;
}

/** A revision of AutoModerator's config page: who made it, when, and why. Never its text. */
export interface ConfigRevision {
    readonly id: string;
    readonly date: Date;
    readonly author: string;
    readonly reason: string;
}

/** An edit to AutoModerator's config the watch noted: when, and by whom. */
export interface ConfigEdit {
    readonly at: number;
    readonly by: string;
}

/** What AutoModerator removed in the hour after an edit, and its hourly average over the day before. */
export interface Misfire {
    readonly sinceEdit: number;
    readonly hourlyAverage: number;
}

/** AutoModerator's config, a page of the subreddit's wiki. */
export const CONFIG_PAGE = "config/automoderator";
const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
/** A revision is an action's when its moderator made it within two minutes of the action. */
const EDIT_MATCH_MS = 120_000;
/** AutoModerator may be misfiring when it removes at least 20 items in the hour after an edit... */
const MISFIRE_MINIMUM = 20;
/** ...and at least five times as many as its hourly average over the day before. */
const MISFIRE_FACTOR = 5;
/** Removals, of posts and comments, as spam or not. */
const REMOVALS: ReadonlySet<string> = new Set(["removelink", "removecomment", "spamlink", "spamcomment"]);

export function minuteOf(at: number): number {
    return Math.floor(at / MS_PER_MINUTE);
}

/** The minutes the misfire check reads around an edit: the day before it, and the hour after. */
export function misfireMinutes(editAt: number): Readonly<{ from: number; to: number }> {
    const minute = minuteOf(editAt);
    return { from: minute - HOURS_PER_DAY * MINUTES_PER_HOUR, to: minute + MINUTES_PER_HOUR };
}

/**
 * Whole days a moderator had not acted before `at`, when at least `thresholdDays` (above 0); undefined for a moderator
 * not seen before, or one active within the window.
 */
export function daysDormant(lastAt: number | undefined, at: number, thresholdDays: number): number | undefined {
    if (lastAt === undefined || thresholdDays <= 0) {
        return undefined;
    }
    const days = Math.floor((at - lastAt) / MS_PER_DAY);
    return days >= thresholdDays ? days : undefined;
}

export function isAutoModeratorRemoval(action: WatchedAction): boolean {
    return action.actor === "automoderator" && REMOVALS.has(action.type);
}

/** Whether the config's revision is this action's: made by its moderator, within two minutes of it. */
export function isEditBy(revision: ConfigRevision | undefined, action: WatchedAction): boolean {
    const moderator = action.moderatorName?.toLowerCase() ?? "";
    return (
        revision !== undefined &&
        moderator !== "" &&
        revision.author.toLowerCase() === moderator &&
        Math.abs(revision.date.getTime() - action.occurredAt.getTime()) <= EDIT_MATCH_MS
    );
}

/** How many times each non-blank line occurs in the text. */
function lineCounts(text: string): Readonly<Record<string, number>> {
    return text
        .split("\n")
        .map((line: string): string => line.trim())
        .filter((line: string): boolean => line !== "")
        .reduce(
            (counts: Readonly<Record<string, number>>, line: string): Readonly<Record<string, number>> => ({
                ...counts,
                [line]: (counts[line] ?? 0) + 1,
            }),
            {},
        );
}

/** How many lines `from` lacks of `to`'s, a line repeated counting each time. */
function linesBeyond(to: Readonly<Record<string, number>>, from: Readonly<Record<string, number>>): number {
    return Object.entries(to).reduce(
        (sum: number, [line, count]: readonly [string, number]): number => sum + Math.max(0, count - (from[line] ?? 0)),
        0,
    );
}

/** How many lines `after` adds to `before`, and how many it takes away; blank lines are left out. */
export function lineChanges(before: string, after: string): Readonly<{ added: number; removed: number }> {
    const [beforeLines, afterLines] = [lineCounts(before), lineCounts(after)];
    return { added: linesBeyond(afterLines, beforeLines), removed: linesBeyond(beforeLines, afterLines) };
}

/** Whether `now` falls in the hour after the edit at `editAt`, when a misfire is looked for. */
export function isMisfireWindow(editAt: number, now: number): boolean {
    return now >= editAt && now - editAt <= MINUTES_PER_HOUR * MS_PER_MINUTE;
}

/**
 * Whether AutoModerator seems to be misfiring at `now`, given its removals by minute (minute, count): within the hour after the edit
 * at `editAt`, it removed at least 20 items, and five times its hourly average over the day before.
 */
export function misfireAfter(
    removals: readonly (readonly [number, number])[],
    editAt: number,
    now: number,
): Misfire | undefined {
    if (!isMisfireWindow(editAt, now)) {
        return undefined;
    }
    const { from, to } = misfireMinutes(editAt);
    const editMinute = minuteOf(editAt);
    const total = (start: number, end: number): number =>
        removals
            .filter(([minute]: readonly [number, number]): boolean => minute >= start && minute < end)
            .reduce((sum: number, [, count]: readonly [number, number]): number => sum + count, 0);
    const sinceEdit = total(editMinute, to);
    const hourlyAverage = total(from, editMinute) / HOURS_PER_DAY;
    return sinceEdit >= MISFIRE_MINIMUM && sinceEdit >= MISFIRE_FACTOR * hourlyAverage
        ? { sinceEdit, hourlyAverage }
        : undefined;
}
