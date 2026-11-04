import type { PostDeletion, SeenPost } from "../domain/posts.js";

/** EventSource.USER in @devvit/protos: the post's author deleted it. */
const EVENT_SOURCE_USER = 1;

/** What the app reads from a PostCreate or PostUpdate trigger event; Devvit's event types satisfy it. */
export type PostChangeEvent = Readonly<{
    post?: Readonly<{ id: string; score: number; title: string; permalink: string }> | undefined;
}>;

/** What the app reads from a PostDelete trigger event; the numbers are Devvit's EventSource and DeletionReason. */
export type PostDeleteEvent = Readonly<{
    postId: string;
    source: number;
    deletedAt?: Date | undefined;
    reason: number;
    subreddit?: Readonly<{ name: string }> | undefined;
}>;

/** The post in a PostCreate or PostUpdate trigger event, or undefined when the event carries none. */
export function seenPostFromTriggerEvent({ post }: PostChangeEvent): SeenPost | undefined {
    return post === undefined
        ? undefined
        : { id: post.id, score: post.score, title: post.title, permalink: post.permalink };
}

/** The deletion in a PostDelete trigger event. */
export function postDeletionFromTriggerEvent(event: PostDeleteEvent): PostDeletion {
    return {
        postId: event.postId,
        deletedByUser: event.source === EVENT_SOURCE_USER,
        deletedAt: event.deletedAt,
        reason: event.reason,
        subredditName: event.subreddit?.name,
    };
}
