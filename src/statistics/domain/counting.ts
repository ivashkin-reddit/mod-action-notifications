/** Who took an action, as team statistics count them: moderators, AutoModerator, or Reddit's own accounts. */
export type ActorKind = "moderators" | "automoderator" | "reddit";

/** A mod action, as team statistics count it. */
export interface CountedAction {
    /** Devvit's ID for it; undefined or '' when the event names none. */
    readonly id: string | undefined;
    /** Reddit's action type, such as removelink; '' when the event names none. */
    readonly type: string;
    readonly actor: ActorKind;
    /** The moderator's username, only to count how many moderators acted: it is never kept. */
    readonly moderatorName: string | undefined;
    readonly occurredAt: Date;
    /** The post the action was on, or the comment's post; undefined for an action on a user. */
    readonly postId: string | undefined;
    /** For a ban: its length in days, 0 when permanent; undefined when unknown. */
    readonly banDays: number | undefined;
}

/** What one action adds to its UTC day's counts. Holds no username. */
export interface ActionTally {
    readonly day: string;
    /** The field of the day's action counts it adds to: who took it, and its type. */
    readonly actionField: string;
    /** For a moderator's action: its UTC hour. */
    readonly hour: number | undefined;
    /** For a moderator's action: a hash of their username, to count how many moderators acted. */
    readonly moderatorHash: string | undefined;
    /** What it adds to the day's ban counts: nothing for an action that is not a ban or an unban. */
    readonly banCounts: Readonly<Record<string, number>>;
    /** For a removal: the post it was on, to find the most-moderated threads. */
    readonly removedFrom: string | undefined;
}

/** Removals, of posts and comments, as spam or not: what makes a thread moderated. */
const REMOVALS: ReadonlySet<string> = new Set(["removelink", "removecomment", "spamlink", "spamcomment"]);
const DAY_LENGTH = 10;
const HASH_BASE = 31;
const HASH_MODULUS = 4_294_967_296;
const HEX = 16;
const HASH_DIGITS = 8;

/** The UTC day a time falls on, as YYYY-MM-DD. */
export function dayOf(at: Date): string {
    return at.toISOString().slice(0, DAY_LENGTH);
}

/**
 * A short hash of a username, ignoring case: enough to count how many moderators acted without keeping who. Eight hex
 * digits of a 32-bit polynomial hash of its UTF-16 code units.
 */
export function moderatorHash(name: string): string {
    const lower = name.toLowerCase();
    const hash = Array.from({ length: lower.length }, (_unused: unknown, index: number): number =>
        lower.charCodeAt(index),
    ).reduce((total: number, code: number): number => (total * HASH_BASE + code) % HASH_MODULUS, 0);
    return hash.toString(HEX).padStart(HASH_DIGITS, "0");
}

/** What a ban or an unban adds to the day's ban counts; a ban's length is counted when it is known. */
function banCountsOf(type: string, days: number | undefined): Readonly<Record<string, number>> {
    if (type === "unbanuser") {
        return { unbans: 1 };
    }
    if (type !== "banuser") {
        return {};
    }
    if (days === undefined) {
        return { bans: 1 };
    }
    return days === 0 ? { bans: 1, permanent: 1 } : { bans: 1, temporary: 1, banDays: days };
}

export function tallyOf(action: CountedAction): ActionTally {
    const type = action.type === "" ? "unknown" : action.type;
    const byModerator = action.actor === "moderators";
    const name = action.moderatorName ?? "";
    return {
        day: dayOf(action.occurredAt),
        actionField: `${action.actor}:${type}`,
        hour: byModerator ? action.occurredAt.getUTCHours() : undefined,
        moderatorHash: byModerator && name !== "" ? moderatorHash(name) : undefined,
        banCounts: banCountsOf(type, action.banDays),
        removedFrom: REMOVALS.has(type) ? action.postId : undefined,
    };
}
