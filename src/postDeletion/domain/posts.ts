/** A post as Reddit shows it when it is deleted: a deleted post keeps its title, link and score. */
export interface DeletedPost {
    readonly score: number;
    readonly title: string;
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
    /** Reddit's deletion reason, named. */
    readonly reason: string;
    /** The author's username, from the event: the deleted post no longer shows it. '' when the event names none. */
    readonly authorName: string;
    readonly subredditName: string | undefined;
}

/** A user deleting a post alerts moderators when the post had at least the threshold score; 0 turns alerts off. */
export function deservesAlert(score: number, upvoteThreshold: number): boolean {
    return upvoteThreshold > 0 && score >= upvoteThreshold;
}
