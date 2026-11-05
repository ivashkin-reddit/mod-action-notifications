import type { TriggerContext, User } from "@devvit/public-api";
import type { ModerationLookups } from "../application/ports.js";
import type { BanLogEntry } from "../domain/banDuration.js";
import { isBlank } from "../domain/modAction.js";

/** A fetched mod list is reused for five minutes. */
const MOD_LIST_REUSE_MS = 300_000;
const RECENT_BANS = 10;

type ModerationReddit = Readonly<
    Pick<TriggerContext["reddit"], "getCurrentSubreddit" | "getCurrentSubredditName" | "getModerationLog">
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

export function createRedditModerationLookups(reddit: ModerationReddit, modList: ModList): ModerationLookups {
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
            const name = isBlank(subredditName) ? await reddit.getCurrentSubredditName() : subredditName;
            if (name === "") {
                return [];
            }
            const listing = reddit.getModerationLog({ subredditName: name, type: "banuser", limit: RECENT_BANS });
            return (await listing.get(RECENT_BANS)).map(banLogEntryOf);
        },
    };
}
