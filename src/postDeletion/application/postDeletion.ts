import { deletionAlertsOn, deservesAlert } from "../domain/posts.js";
import type { PostDeletion } from "../domain/posts.js";
import type { PostDeletionAlerts, PostLookup } from "./ports.js";

export interface PostDeletionConfig {
    /** 0 turns deleted-post alerts off. */
    readonly upvoteThreshold: number;
}

export interface PostDeletionPorts {
    readonly posts: PostLookup;
    readonly alerts: PostDeletionAlerts;
}

async function alertIfHighScore(
    deletion: PostDeletion,
    config: PostDeletionConfig,
    ports: PostDeletionPorts,
): Promise<void> {
    // Votes fire no trigger, so the score that counts is the one Reddit shows as the post is deleted.
    const post = await ports.posts.deletedPost(deletion.postId);
    if (!deservesAlert(post.score, config.upvoteThreshold)) {
        return;
    }
    await ports.alerts.highScorePostDeleted({
        post,
        authorName: deletion.authorName,
        subredditName: deletion.subredditName ?? post.subredditName,
        deletedAt: (deletion.deletedAt ?? new Date()).toISOString(),
        reason: deletion.reason,
    });
}

/** Alerts moderators when a user deletes their own post that had a high score. Never rejects. */
export async function alertOnUserDeletion(
    config: PostDeletionConfig,
    deletion: PostDeletion,
    ports: PostDeletionPorts,
): Promise<void> {
    // Checked before the post is looked up on Reddit.
    if (!deletionAlertsOn(config.upvoteThreshold) || !deletion.deletedByUser) {
        return;
    }
    if (deletion.postId === "") {
        console.error("PostDelete event missing postId");
        return;
    }
    try {
        await alertIfHighScore(deletion, config, ports);
    } catch (error) {
        // The post could not be read: without its score there is no alert to send.
        console.error("Failed to handle post delete:", error);
    }
}
