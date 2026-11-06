/**
 * What the alert needs of a post as Reddit shows it when it is deleted: a deleted post keeps its link and score.
 * Its title and author are not read: Devvit's rules ask apps to delete a deleted post's content, and the alert
 * goes to Slack.
 */
export interface DeletedPost {
    readonly score: number;
    /** With the post's title in it, as Reddit gives it; the alert links to the post without it. */
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
    readonly subredditName: string | undefined;
}

/** Whether deleted-post alerts are on: a threshold of 0 turns them off. */
export function deletionAlertsOn(upvoteThreshold: number): boolean {
    return upvoteThreshold > 0;
}

/** A user deleting a post alerts moderators when the post had at least the threshold score, while alerts are on. */
export function deservesAlert(score: number, upvoteThreshold: number): boolean {
    return deletionAlertsOn(upvoteThreshold) && score >= upvoteThreshold;
}
