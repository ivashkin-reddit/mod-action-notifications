/** A post the app has seen created or updated. */
export interface SeenPost {
    /** '' when Devvit gave none. */
    readonly id: string;
    readonly score: number;
    readonly title: string;
    readonly permalink: string;
}

/** A post remembered so that its deletion can be alerted on. */
export interface RememberedPost {
    readonly id: string;
    readonly score: number;
    readonly title: string;
    readonly authorName: string;
    readonly permalink: string;
    readonly subredditName: string;
}

/** A post being deleted. */
export interface PostDeletion {
    /** '' when Devvit gave none. */
    readonly postId: string;
    /** Deleted by its author, as opposed to by a moderator or an admin. */
    readonly deletedByUser: boolean;
    readonly deletedAt: Date | undefined;
    /** Reddit's deletion reason, as Devvit gives it. */
    readonly reason: string | number;
    readonly subredditName: string | undefined;
}

/**
 * A post is remembered once its score reaches half the alert threshold, so posts that go on to reach the threshold
 * are already known when they are deleted, without remembering every post.
 */
const REMEMBER_FROM_SHARE_OF_THRESHOLD = 0.5;

export function isWorthRemembering(score: number, upvoteThreshold: number): boolean {
    return score >= upvoteThreshold * REMEMBER_FROM_SHARE_OF_THRESHOLD;
}

/** A user deleting a post alerts moderators when the post had at least the threshold score. */
export function deservesAlert(post: RememberedPost, upvoteThreshold: number): boolean {
    return post.score >= upvoteThreshold;
}

/**
 * What a seen post is remembered as. The app does not read the author's or the subreddit's name, so both are
 * remembered as "Unknown".
 */
export function rememberedPost(post: SeenPost): RememberedPost {
    return { ...post, authorName: "Unknown", subredditName: "Unknown" };
}
