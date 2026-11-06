import type { PostDeletion } from "../domain/posts.js";

/** EventSource.USER in @devvit/protos: the post's author deleted it. */
const EVENT_SOURCE_USER = 1;

/** Names for Devvit's DeletionReason values (@devvit/protos), indexed by value: UNSPECIFIED_DELETION_REASON is 0. */
const DELETION_REASONS: readonly string[] = ["Unspecified", "Spam", "Legal", "Other", "Unknown", "Explicit content"];

/** What the app reads from a PostDelete trigger event; the numbers are Devvit's EventSource and DeletionReason. */
export type PostDeleteEvent = Readonly<{
    postId: string;
    source: number;
    deletedAt?: Date | undefined;
    reason: number;
    subreddit?: Readonly<{ name: string }> | undefined;
}>;

/** The deletion in a PostDelete trigger event. */
export function postDeletionFromTriggerEvent(event: PostDeleteEvent): PostDeletion {
    return {
        postId: event.postId,
        deletedByUser: event.source === EVENT_SOURCE_USER,
        deletedAt: event.deletedAt,
        reason: DELETION_REASONS[event.reason] ?? "Unknown",
        subredditName: event.subreddit?.name,
    };
}
