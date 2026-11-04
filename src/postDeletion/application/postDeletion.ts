import { deservesAlert, isWorthRemembering, rememberedPost } from "../domain/posts.js";
import type { PostDeletion, RememberedPost, SeenPost } from "../domain/posts.js";
import type { PostDeletionAlerts, RememberedPosts } from "./ports.js";

export interface PostDeletionConfig {
    /** Whether alerts have somewhere to go. */
    readonly alertsConfigured: boolean;
    /** 0 turns deleted-post alerts off. */
    readonly upvoteThreshold: number;
}

export interface PostDeletionPorts {
    readonly posts: RememberedPosts;
    readonly alerts: PostDeletionAlerts;
}

/** Remembers a created or updated post whose score makes a deletion alert possible. Never rejects. */
export async function rememberPostScore(
    config: PostDeletionConfig,
    post: SeenPost | undefined,
    posts: RememberedPosts,
): Promise<void> {
    if (config.upvoteThreshold <= 0 || post === undefined || post.id === "") {
        return;
    }
    if (!isWorthRemembering(post.score, config.upvoteThreshold)) {
        return;
    }
    // A post that cannot be remembered only means no alert if it is deleted.
    await posts.remember(rememberedPost(post)).catch((): undefined => undefined);
}

/** The remembered post a user deleted, when it scored high enough to alert on. */
async function deletedHighScorePost(
    deletion: PostDeletion,
    config: PostDeletionConfig,
    posts: RememberedPosts,
): Promise<RememberedPost | undefined> {
    if (deletion.postId === "") {
        console.error("PostDelete event missing postId");
        return undefined;
    }
    if (!deletion.deletedByUser) {
        return undefined;
    }
    const post = await posts.recall(deletion.postId);
    return post !== undefined && deservesAlert(post, config.upvoteThreshold) ? post : undefined;
}

/** Alerts moderators when a user deletes a remembered post that had a high score. Never rejects. */
export async function alertOnUserDeletion(
    config: PostDeletionConfig,
    deletion: PostDeletion,
    ports: PostDeletionPorts,
): Promise<void> {
    if (config.upvoteThreshold <= 0 || !config.alertsConfigured) {
        return;
    }
    try {
        const post = await deletedHighScorePost(deletion, config, ports.posts);
        if (post === undefined) {
            return;
        }
        await ports.alerts.highScorePostDeleted({
            post,
            subredditName: post.subredditName === "" ? (deletion.subredditName ?? "Unknown") : post.subredditName,
            deletedAt: (deletion.deletedAt ?? new Date()).toISOString(),
            reason: deletion.reason,
        });
        await ports.posts.forget(deletion.postId);
    } catch (error) {
        console.error("Failed to handle post delete:", error);
    }
}
