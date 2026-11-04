import type { RememberedPost } from "../domain/posts.js";

export interface RememberedPosts {
    /** Remembers the post for a week, replacing what was remembered about it. */
    readonly remember: (post: RememberedPost) => Promise<void>;
    /** The remembered post, or undefined. Rejects when what is remembered cannot be read. */
    readonly recall: (postId: string) => Promise<RememberedPost | undefined>;
    readonly forget: (postId: string) => Promise<void>;
}

export interface DeletedPostAlert {
    readonly post: RememberedPost;
    readonly subredditName: string;
    /** ISO 8601. */
    readonly deletedAt: string;
    readonly reason: string | number;
}

export interface PostDeletionAlerts {
    readonly highScorePostDeleted: (alert: DeletedPostAlert) => Promise<void>;
}
