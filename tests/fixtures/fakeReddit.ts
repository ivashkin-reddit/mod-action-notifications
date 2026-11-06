import { vi } from "vitest";
import type { Mock } from "vitest";

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

interface Listing<T> {
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

export interface FakeReddit {
    /** The mod list's usernames. */
    moderators: readonly string[];
    /** Who invokes menu items and forms: a moderator with every permission, unless a test says otherwise. */
    currentUser: FakeUser | undefined;
    /** The modqueue (reported and filtered content), the unmoderated listing, and the reports listing. */
    modQueue: readonly QueueItem[];
    unmoderated: readonly QueueItem[];
    reports: readonly QueueItem[];
    modLog: readonly ModLogEntry[];
    /** The posts getPostById finds; it rejects any other ID, as Reddit does. */
    posts: readonly FakePost[];
    readonly moderatorsAll: ListAll<Readonly<{ username: string }>>;
    readonly modQueueAll: ListAll<QueueItem>;
    readonly unmoderatedAll: ListAll<QueueItem>;
    readonly reportsAll: ListAll<QueueItem>;
    readonly getModerators: Mock<() => Listing<Readonly<{ username: string }>>>;
    readonly getModQueue: QueueListing;
    readonly getUnmoderated: QueueListing;
    readonly getReports: QueueListing;
    readonly getCurrentSubreddit: Mock<() => Promise<FakeSubreddit>>;
    readonly getCurrentUser: Mock<() => Promise<FakeUser | undefined>>;
    readonly getCurrentSubredditName: Mock<() => Promise<string>>;
    readonly getPostById: Mock<(id: string) => Promise<FakePost>>;
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
    Pick<FakeReddit, "getModerators" | "getModQueue" | "getUnmoderated" | "getReports"> & { name: string }
>;

type RedditState = Pick<
    FakeReddit,
    "moderators" | "currentUser" | "modQueue" | "unmoderated" | "reports" | "modLog" | "posts"
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

export function createFakeReddit(subredditName: string): FakeReddit {
    const reddit: RedditState = {
        moderators: ["ModA", "ModB"],
        currentUser: fakeUser("ModA", ["all"]),
        modQueue: [],
        unmoderated: [],
        reports: [],
        modLog: [],
        posts: [],
    };
    const moderators = listingOf((): readonly Readonly<{ username: string }>[] =>
        reddit.moderators.map((username: string): { username: string } => ({ username })),
    );
    const modQueue = listingOf((): readonly QueueItem[] => reddit.modQueue);
    const unmoderated = listingOf((): readonly QueueItem[] => reddit.unmoderated);
    const reports = listingOf((): readonly QueueItem[] => reddit.reports);
    const subreddit: FakeSubreddit = {
        name: subredditName,
        getModerators: moderators.open,
        getModQueue: modQueue.open,
        getUnmoderated: unmoderated.open,
        getReports: reports.open,
    };
    return Object.assign(reddit, {
        moderatorsAll: moderators.all,
        modQueueAll: modQueue.all,
        unmoderatedAll: unmoderated.all,
        reportsAll: reports.all,
        ...subreddit,
        getCurrentSubreddit: vi.fn(async (): Promise<FakeSubreddit> => await Promise.resolve(subreddit)),
        getCurrentUser: vi.fn(async (): Promise<FakeUser | undefined> => await Promise.resolve(reddit.currentUser)),
        getCurrentSubredditName: vi.fn(async (): Promise<string> => await Promise.resolve(subredditName)),
        getPostById: vi.fn(async (id: string): Promise<FakePost> => {
            const post = reddit.posts.find((candidate: FakePost): boolean => candidate.id === id);
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
                await Promise.resolve(reddit.modLog.slice(0, count)),
        })),
    });
}
