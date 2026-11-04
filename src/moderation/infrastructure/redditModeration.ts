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

/** The subreddit's mod list as last fetched. Create one per app process, so lookups share it. */
export interface ModListCache {
    /** The cached list, when it was fetched for this subreddit less than five minutes before `now`. */
    readonly fresh: (subredditName: string, now: number) => readonly string[] | undefined;
    readonly store: (subredditName: string, fetchedAt: number, moderators: readonly string[]) => void;
}

export function createModListCache(): ModListCache {
    const state: {
        cached: { subredditName: string; fetchedAt: number; moderators: readonly string[] } | undefined;
    } = { cached: undefined };
    return {
        fresh: (subredditName: string, now: number): readonly string[] | undefined => {
            const { cached } = state;
            return cached?.subredditName === subredditName && now - cached.fetchedAt < MOD_LIST_REUSE_MS
                ? cached.moderators
                : undefined;
        },
        store: (subredditName: string, fetchedAt: number, moderators: readonly string[]): void => {
            state.cached = { subredditName, fetchedAt, moderators };
        },
    };
}

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

export function createRedditModerationLookups(reddit: ModerationReddit, modListCache: ModListCache): ModerationLookups {
    return {
        isModerator: async (username: string): Promise<boolean> => {
            const subreddit = await reddit.getCurrentSubreddit();
            const now = Date.now();
            const cached = modListCache.fresh(subreddit.name, now);
            if (cached !== undefined) {
                return cached.includes(username.toLowerCase());
            }
            const moderators = await subreddit.getModerators().all();
            const usernames = moderators.map((moderator: Readonly<Pick<User, "username">>): string =>
                moderator.username.toLowerCase(),
            );
            modListCache.store(subreddit.name, now, usernames);
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
