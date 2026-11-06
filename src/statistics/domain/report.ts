/** What was counted on one UTC day. Holds no username. */
export interface DayCounts {
    /** Actions, by who took them and their type: "{actor}:{type}". */
    readonly actions: Readonly<Record<string, number>>;
    /** Moderators' actions, by UTC hour: "0" to "23". */
    readonly hours: Readonly<Record<string, number>>;
    /** Bans and unbans: bans, temporary, permanent, banDays (the temporary bans' days), unbans. */
    readonly bans: Readonly<Record<string, number>>;
    /** Hashes of the moderators who acted. */
    readonly moderators: readonly string[];
    /** Removals on each post. */
    readonly threads: readonly Readonly<{ postId: string; removals: number }>[];
}

/** One day's counts, and how many of its hours the report covers: 24 for a day gone by, fewer for today. */
export type ReportDay = Readonly<{ counts: DayCounts; hours: number }>;

/** The team's moderation over a period, as a whole: no figure is any one moderator's. */
export interface TeamReport {
    readonly actions: Readonly<{ total: number; moderators: number; automoderator: number; reddit: number }>;
    /** The most common action types, by anyone, most common first. */
    readonly topTypes: readonly Readonly<{ type: string; count: number }>[];
    /** The hours the period covers, and how many of them saw no moderator action. */
    readonly hours: number;
    readonly quietHours: number;
    /** The UTC hour with the most moderator actions; undefined when there were none. */
    readonly busiestHour: number | undefined;
    readonly bans: Readonly<{
        bans: number;
        temporary: number;
        permanent: number;
        /** The temporary bans' average length in days; undefined without one. */
        averageDays: number | undefined;
        unbans: number;
    }>;
    /** How many moderators acted. */
    readonly activeModerators: number;
    /** The posts with the most removals, most first. */
    readonly topThreads: readonly Readonly<{ postId: string; removals: number }>[];
}

/** How many of the most common types, and of the most-moderated threads, a report gives. */
const TOP = 5;
const HOURS_IN_DAY = 24;
const MS_PER_DAY = 86_400_000;
const DAY_LENGTH = 10;

type Tally = Readonly<Record<string, number>>;

function sumOf(tallies: readonly Tally[]): Tally {
    return tallies.reduce(
        (total: Tally, tally: Tally): Tally =>
            Object.entries(tally).reduce(
                (sum: Tally, [field, count]: readonly [string, number]): Tally => ({
                    ...sum,
                    [field]: (sum[field] ?? 0) + count,
                }),
                total,
            ),
        {},
    );
}

/** Biggest count first; equal counts by name. */
function byCountThenName(first: readonly [string, number], second: readonly [string, number]): number {
    const byCount = second[1] - first[1];
    return byCount === 0 ? first[0].localeCompare(second[0]) : byCount;
}

/** The `count` biggest entries of a tally, biggest first, ties by name. */
function biggest(tally: Tally, count: number): readonly (readonly [string, number])[] {
    return Object.entries(tally).sort(byCountThenName).slice(0, count);
}

function actionsBy(actions: Tally): TeamReport["actions"] {
    const byActor = (actor: string): number =>
        Object.entries(actions)
            .filter(([field]: readonly [string, number]): boolean => field.startsWith(`${actor}:`))
            .reduce((sum: number, [, count]: readonly [string, number]): number => sum + count, 0);
    const [moderators, automoderator, reddit] = [byActor("moderators"), byActor("automoderator"), byActor("reddit")];
    return { total: moderators + automoderator + reddit, moderators, automoderator, reddit };
}

/** The action types, summed over who took them. */
function byType(actions: Tally): Tally {
    return sumOf(
        Object.entries(actions).map(([field, count]: readonly [string, number]): Tally => ({
            [field.slice(field.indexOf(":") + 1)]: count,
        })),
    );
}

/** The hours a day covers with no moderator action in them. */
function quietHoursOf({ counts, hours }: ReportDay): number {
    return Array.from(
        { length: Math.min(hours, HOURS_IN_DAY) },
        (_unused: unknown, hour: number): number => hour,
    ).filter((hour: number): boolean => (counts.hours[String(hour)] ?? 0) === 0).length;
}

function bansOf(bans: Tally): TeamReport["bans"] {
    const temporary = bans["temporary"] ?? 0;
    return {
        bans: bans["bans"] ?? 0,
        temporary,
        permanent: bans["permanent"] ?? 0,
        averageDays: temporary === 0 ? undefined : (bans["banDays"] ?? 0) / temporary,
        unbans: bans["unbans"] ?? 0,
    };
}

export function teamReport(days: readonly ReportDay[]): TeamReport {
    const actions = sumOf(days.map(({ counts }: ReportDay): Tally => counts.actions));
    const [busiest] = biggest(sumOf(days.map(({ counts }: ReportDay): Tally => counts.hours)), 1);
    const threads = sumOf(
        days.flatMap(({ counts }: ReportDay): Tally[] =>
            counts.threads.map(({ postId, removals }: Readonly<{ postId: string; removals: number }>): Tally => ({
                [postId]: removals,
            })),
        ),
    );
    return {
        actions: actionsBy(actions),
        topTypes: biggest(byType(actions), TOP).map(([type, count]): { type: string; count: number } => ({
            type,
            count,
        })),
        hours: days.reduce((sum: number, { hours }: ReportDay): number => sum + Math.min(hours, HOURS_IN_DAY), 0),
        quietHours: days.reduce((sum: number, day: ReportDay): number => sum + quietHoursOf(day), 0),
        busiestHour: busiest === undefined || busiest[1] === 0 ? undefined : Number(busiest[0]),
        bans: bansOf(sumOf(days.map(({ counts }: ReportDay): Tally => counts.bans))),
        activeModerators: new Set(days.flatMap(({ counts }: ReportDay): readonly string[] => counts.moderators)).size,
        topThreads: biggest(threads, TOP).map(([postId, removals]): { postId: string; removals: number } => ({
            postId,
            removals,
        })),
    };
}

/** The `count` UTC days ending `endOffset` days before the day of `now` (0 ends with today), oldest first. */
export function dayRange(now: number, count: number, endOffset: number): readonly string[] {
    return Array.from({ length: count }, (_unused: unknown, index: number): string =>
        new Date(now - (endOffset + count - 1 - index) * MS_PER_DAY).toISOString().slice(0, DAY_LENGTH),
    );
}
