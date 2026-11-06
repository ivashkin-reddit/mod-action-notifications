import type { DeletedPost } from "../domain/posts.js";

export interface PostLookup {
    /** The post as Reddit shows it now. Rejects when it cannot be read. */
    readonly deletedPost: (postId: string) => Promise<DeletedPost>;
}

export interface DeletedPostAlert {
    readonly post: DeletedPost;
    readonly subredditName: string;
    /** ISO 8601. */
    readonly deletedAt: string;
    readonly reason: string;
}

/** Which deletions have been alerted. */
export interface DeletionAlertClaims {
    /**
     * Claims the alert for a deletion of the post: true the first time, false when it was already claimed within
     * the last day, as for an event Devvit delivers again. Safe for deliveries handled at once: one claims it.
     * Rejects when storage fails.
     */
    readonly claim: (postId: string) => Promise<boolean>;
}

export interface PostDeletionAlerts {
    readonly highScorePostDeleted: (alert: DeletedPostAlert) => Promise<void>;
}
