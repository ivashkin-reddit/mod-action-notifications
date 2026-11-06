import type { TriggerContext, User } from "@devvit/public-api";
import type { ModerationLookups } from "../application/ports.js";
import type { BanLogEntry } from "../domain/banDuration.js";
import type { NoteEntry, NoteKind } from "../domain/history.js";
import { isBlank } from "../domain/modAction.js";

/** A fetched mod list is reused for five minutes. */
const MOD_LIST_REUSE_MS = 300_000;
const RECENT_BANS = 10;
/** At most this many of a user's mod notes are read: enough to cover any window a ban alert counts. */
const MOD_NOTES_READ = 100;
/** Reddit's mod note types a ban alert counts, by the kind it counts them as. */
const NOTE_KINDS: ReadonlyMap<string, NoteKind> = new Map([
    ["REMOVAL", "removal"],
    ["SPAM", "spam"],
    ["BAN", "ban"],
    ["MUTE", "mute"],
    ["NOTE", "note"],
]);

type ModerationReddit = Readonly<
    Pick<
        TriggerContext["reddit"],
        "getCurrentSubreddit" | "getCurrentSubredditName" | "getModerationLog" | "getModNotes"
    >
>;

/** A ban as Devvit's mod log lists it. */
type LoggedBan = Readonly<{
    id: string;
    moderatorName: string;
    createdAt: Date;
    details?: string | undefined;
    description?: string | undefined;
    target?: Readonly<{ author?: string | undefined }> | undefined;
}>;

/**
 * Each installation's mod list as last fetched, keyed by installation (its subreddit ID): one app process can serve
 * several. Create one per app process, so lookups share it.
 */
export interface ModListCache {
    /** The installation's cached list, lower-cased, when it was fetched less than five minutes before `now`. */
    readonly fresh: (installation: string, now: number) => readonly string[] | undefined;
    readonly store: (installation: string, fetchedAt: number, moderators: readonly string[]) => void;
}

export function createModListCache(): ModListCache {
    const lists = new Map<string, Readonly<{ fetchedAt: number; moderators: readonly string[] }>>();
    return {
        fresh: (installation: string, now: number): readonly string[] | undefined => {
            const cached = lists.get(installation);
            return cached !== undefined && now - cached.fetchedAt < MOD_LIST_REUSE_MS ? cached.moderators : undefined;
        },
        store: (installation: string, fetchedAt: number, moderators: readonly string[]): void => {
            lists.set(installation, { fetchedAt, moderators });
        },
    };
}

/** The process's mod-list cache and the installation a lookup is for. */
export type ModList = Readonly<{ cache: ModListCache; installation: string }>;

function banLogEntryOf(entry: LoggedBan): BanLogEntry {
    return {
        id: entry.id,
        moderatorName: entry.moderatorName,
        createdAt: entry.createdAt,
        details: entry.details,
        description: entry.description,
        targetAuthor: entry.target?.author,
    };
}

/**
 * The subreddit a lookup is for: the one the event names, else the current one, whose name is asked of Reddit at
 * most once for a set of lookups (one event's). '' when Reddit gives none.
 */
function subredditNames(
    reddit: Readonly<Pick<ModerationReddit, "getCurrentSubredditName">>,
): (named: string | undefined) => Promise<string> {
    let current: Promise<string> | undefined;
    return async (named: string | undefined): Promise<string> => {
        if (!isBlank(named)) {
            return named;
        }
        current ??= reddit.getCurrentSubredditName();
        return await current;
    };
}

export function createRedditModerationLookups(reddit: ModerationReddit, modList: ModList): ModerationLookups {
    const subredditNameOf = subredditNames(reddit);
    return {
        isModerator: async (username: string): Promise<boolean> => {
            const now = Date.now();
            const cached = modList.cache.fresh(modList.installation, now);
            if (cached !== undefined) {
                return cached.includes(username.toLowerCase());
            }
            const moderators = await (await reddit.getCurrentSubreddit()).getModerators().all();
            const usernames = moderators.map((moderator: Readonly<Pick<User, "username">>): string =>
                moderator.username.toLowerCase(),
            );
            modList.cache.store(modList.installation, now, usernames);
            return usernames.includes(username.toLowerCase());
        },
        recentBans: async (subredditName: string | undefined): Promise<readonly BanLogEntry[]> => {
            const name = await subredditNameOf(subredditName);
            if (name === "") {
                return [];
            }
            const listing = reddit.getModerationLog({ subredditName: name, type: "banuser", limit: RECENT_BANS });
            return (await listing.get(RECENT_BANS)).map(banLogEntryOf);
        },
        modNotes: async (subredditName: string | undefined, username: string): Promise<readonly NoteEntry[]> => {
            const subreddit = await subredditNameOf(subredditName);
            if (subreddit === "") {
                throw new Error("Reddit gave no name for the subreddit");
            }
            const notes = await reddit.getModNotes({ subreddit, user: username, limit: MOD_NOTES_READ }).all();
            return notes.map(({ type, createdAt }: Readonly<{ type: string; createdAt: Date }>): NoteEntry => ({
                kind: NOTE_KINDS.get(type) ?? "other",
                createdAt,
            }));
        },
    };
}
