import type { DeletedPost } from "../domain/posts.js";

export interface PostLookup {
    /** The post as Reddit shows it now. Rejects when it cannot be read. */
    readonly deletedPost: (postId: string) => Promise<DeletedPost>;
}

export interface DeletedPostAlert {
    readonly post: DeletedPost;
    /** '' when unknown. */
    readonly authorName: string;
    readonly subredditName: string;
    /** ISO 8601. */
    readonly deletedAt: string;
    readonly reason: string;
}

export interface PostDeletionAlerts {
    readonly highScorePostDeleted: (alert: DeletedPostAlert) => Promise<void>;
}
