import { vi } from "vitest";
import type { Mock } from "vitest";
import { wikiOf } from "./fakeWiki.js";
import type { FakeWikiMethods, FakeWikiRevision } from "./fakeWiki.js";

/**
 * A stand-in for the Reddit client in Devvit's context: the members the app uses, each a vi.fn, with the state they
 * read. Listings are returned synchronously and read the state when their `all` is called, as Devvit's do.
 */
export interface QueueItem {
    readonly id: string;
    readonly title?: string;
    /** A comment's post; a post has none. */
    readonly postId?: string;
    readonly createdAt: Date;
    readonly permalink: string;
}

/** A mod log entry, as `reddit.getModerationLog(...).get(n)` returns it. */
export interface ModLogEntry {
    readonly id: string;
    readonly moderatorName: string;
    readonly createdAt: Date;
    readonly details?: string;
    readonly description?: string;
    readonly target?: Readonly<{ author: string }>;
}

export interface Listing<T> {
    readonly all: () => Promise<readonly T[]>;
}

/** A post as `reddit.getPostById` returns it. */
export interface FakePost {
    readonly id: string;
    readonly title: string;
    readonly score: number;
    readonly permalink: string;
    readonly subredditName: string;
}

type ListAll<T> = Mock<() => Promise<readonly T[]>>;
type QueueListing = Mock<(options: Readonly<{ type: string }>) => Listing<QueueItem>>;

/** The user who pressed a menu item or submitted a form, and their moderator permissions here. */
export interface FakeUser {
    readonly username: string;
    readonly getModPermissionsForSubreddit: Mock<(subredditName: string) => Promise<string[]>>;
}

/** A modmail notification, as `reddit.modMail.createModNotification` takes it. */
export type ModNotification = Readonly<{ subject: string; bodyMarkdown: string; subredditId: string }>;

/** An entry in a user's mod notes, as `reddit.getModNotes(...).all()` returns it: what the app reads. */
export interface FakeModNote {
    readonly user: string;
    readonly type: string;
    readonly createdAt: Date;
}

/** What `reddit.getModNotes` is asked for. */
type ModNotesQuery = Readonly<{ subreddit: string; user: string; limit: number }>;

export interface FakeReddit extends FakeWikiMethods {
    /** The mod list's usernames. */
    moderators: readonly string[];
    /** Who invokes menu items and forms: a moderator with every permission, unless a test says otherwise. */
    currentUser: FakeUser | undefined;
    /** The modqueue (reported and filtered content), the unmoderated listing, and the reports listing. */
    modQueue: readonly QueueItem[];
    unmoderated: readonly QueueItem[];
    reports: readonly QueueItem[];
    /** Reddit's spam queue, and its edited queue. */
    spam: readonly QueueItem[];
    edited: readonly QueueItem[];
    modLog: readonly ModLogEntry[];
    /** The posts getPostById finds; it rejects any other ID, as Reddit does. */
    posts: readonly FakePost[];
    /** Every user's mod notes; getModNotes returns those of the user asked for. */
    modNotes: readonly FakeModNote[];
    /** AutoModerator's config page's revisions, newest first. */
    wikiRevisions: readonly FakeWikiRevision[];
    readonly moderatorsAll: ListAll<Readonly<{ username: string }>>;
    readonly modQueueAll: ListAll<QueueItem>;
    readonly unmoderatedAll: ListAll<QueueItem>;
    readonly reportsAll: ListAll<QueueItem>;
    readonly spamAll: ListAll<QueueItem>;
    readonly editedAll: ListAll<QueueItem>;
    readonly getModerators: Mock<() => Listing<Readonly<{ username: string }>>>;
    readonly getModQueue: QueueListing;
    readonly getUnmoderated: QueueListing;
    readonly getReports: QueueListing;
    readonly getSpam: QueueListing;
    readonly getEdited: QueueListing;
    readonly getCurrentSubreddit: Mock<() => Promise<FakeSubreddit>>;
    readonly getCurrentUser: Mock<() => Promise<FakeUser | undefined>>;
    readonly getCurrentSubredditName: Mock<() => Promise<string>>;
    readonly getPostById: Mock<(id: string) => Promise<FakePost>>;
    readonly getModNotes: Mock<(query: ModNotesQuery) => Listing<FakeModNote>>;
    readonly getModerationLog: Mock<
        (options: Readonly<{ subredditName: string; type: string; limit: number }>) => {
            readonly get: (count: number) => Promise<readonly ModLogEntry[]>;
        }
    >;
    readonly modMail: Readonly<{
        /** Sends a notification to the subreddit's modmail, and returns its conversation's ID. */
        createModNotification: Mock<(notification: ModNotification) => Promise<string>>;
    }>;
}

type FakeSubreddit = Readonly<
    Pick<FakeReddit, "getModerators" | "getModQueue" | "getUnmoderated" | "getReports" | "getSpam" | "getEdited"> & {
        name: string;
    }
>;

type RedditState = Pick<
    FakeReddit,
    | "moderators"
    | "currentUser"
    | "modQueue"
    | "unmoderated"
    | "reports"
    | "spam"
    | "edited"
    | "modLog"
    | "posts"
    | "modNotes"
    | "wikiRevisions"
>;

/** A user with these permissions in the subreddit: none for a user who does not moderate it. */
export function fakeUser(username: string, permissions: readonly string[]): FakeUser {
    return {
        username,
        getModPermissionsForSubreddit: vi.fn(async (): Promise<string[]> => await Promise.resolve([...permissions])),
    };
}

/** A listing that reads the state when its `all` is called, and the vi.fns for both. */
function listingOf<T>(read: () => readonly T[]): Readonly<{ all: ListAll<T>; open: Mock<() => Listing<T>> }> {
    const all: ListAll<T> = vi.fn(async (): Promise<readonly T[]> => await Promise.resolve(read()));
    return { all, open: vi.fn((): Listing<T> => ({ all })) };
}

/** The `all` mocks of the subreddit's listings, with which tests make a listing fail or count its reads. */
type ListingAlls = Pick<
    FakeReddit,
    "moderatorsAll" | "modQueueAll" | "unmoderatedAll" | "reportsAll" | "spamAll" | "editedAll"
>;

/** The subreddit's listings, reading the state when their `all` is called, and the subreddit that opens them. */
function subredditOf(
    state: () => RedditState,
    name: string,
): Readonly<{ subreddit: FakeSubreddit; alls: ListingAlls }> {
    const moderators = listingOf((): readonly Readonly<{ username: string }>[] =>
        state().moderators.map((username: string): { username: string } => ({ username })),
    );
    const modQueue = listingOf((): readonly QueueItem[] => state().modQueue);
    const unmoderated = listingOf((): readonly QueueItem[] => state().unmoderated);
    const reports = listingOf((): readonly QueueItem[] => state().reports);
    const spam = listingOf((): readonly QueueItem[] => state().spam);
    const edited = listingOf((): readonly QueueItem[] => state().edited);
    return {
        subreddit: {
            name,
            getModerators: moderators.open,
            getModQueue: modQueue.open,
            getUnmoderated: unmoderated.open,
            getReports: reports.open,
            getSpam: spam.open,
            getEdited: edited.open,
        },
        alls: {
            moderatorsAll: moderators.all,
            modQueueAll: modQueue.all,
            unmoderatedAll: unmoderated.all,
            reportsAll: reports.all,
            spamAll: spam.all,
            editedAll: edited.all,
        },
    };
}

/** The client's lookups beside the subreddit's listings: posts by ID, mod notes, the mod log, and modmail. */
function lookupsOf(
    state: () => RedditState,
): Pick<FakeReddit, "getPostById" | "getModNotes" | "getModerationLog" | "modMail"> {
    return {
        getModNotes: vi.fn((query: ModNotesQuery): Listing<FakeModNote> => ({
            all: async (): Promise<readonly FakeModNote[]> =>
                await Promise.resolve(
                    state().modNotes.filter(
                        (note: FakeModNote): boolean => note.user.toLowerCase() === query.user.toLowerCase(),
                    ),
                ),
        })),
        getPostById: vi.fn(async (id: string): Promise<FakePost> => {
            const post = state().posts.find((candidate: FakePost): boolean => candidate.id === id);
            if (post === undefined) {
                throw new Error(`post ${id} not found`);
            }
            return await Promise.resolve(post);
        }),
        modMail: {
            createModNotification: vi.fn(async (): Promise<string> => await Promise.resolve("modmail-1")),
        },
        getModerationLog: vi.fn((): { readonly get: (count: number) => Promise<readonly ModLogEntry[]> } => ({
            get: async (count: number): Promise<readonly ModLogEntry[]> =>
                await Promise.resolve(state().modLog.slice(0, count)),
        })),
    };
}

export function createFakeReddit(subredditName: string): FakeReddit {
    const reddit: RedditState = {
        moderators: ["ModA", "ModB"],
        currentUser: fakeUser("ModA", ["all"]),
        modQueue: [],
        unmoderated: [],
        reports: [],
        spam: [],
        edited: [],
        modLog: [],
        posts: [],
        modNotes: [],
        wikiRevisions: [],
    };
    const state = (): RedditState => reddit;
    const { subreddit, alls } = subredditOf(state, subredditName);
    return Object.assign(reddit, {
        ...alls,
        ...subreddit,
        getCurrentSubreddit: vi.fn(async (): Promise<FakeSubreddit> => await Promise.resolve(subreddit)),
        getCurrentUser: vi.fn(async (): Promise<FakeUser | undefined> => await Promise.resolve(reddit.currentUser)),
        getCurrentSubredditName: vi.fn(async (): Promise<string> => await Promise.resolve(subredditName)),
        ...lookupsOf(state),
        ...wikiOf((): readonly FakeWikiRevision[] => reddit.wikiRevisions),
    });
}
