import type { Comment, Post, TriggerContext } from "@devvit/public-api";
import type { ModerationQueues } from "../application/ports.js";
import type { QueueItem } from "../domain/monitoring.js";

type QueuedContent =
    | Readonly<Pick<Comment, "id" | "postId" | "createdAt" | "permalink">>
    | Readonly<Pick<Post, "id" | "createdAt" | "permalink">>;

function queueItemOf(content: QueuedContent): QueueItem {
    // A comment names its post; a post does not.
    const postId = "postId" in content ? content.postId : undefined;
    return {
        kind: postId === undefined ? "post" : "comment",
        id: content.id,
        postId: postId ?? content.id,
        createdAt: content.createdAt,
        permalink: content.permalink,
    };
}

/** Opens the current subreddit's moderation listings; rejects when the subreddit cannot be read. */
export async function openRedditQueues(
    reddit: Readonly<Pick<TriggerContext["reddit"], "getCurrentSubreddit">>,
): Promise<ModerationQueues> {
    const subreddit = await reddit.getCurrentSubreddit();
    return {
        modqueue: async (): Promise<readonly QueueItem[]> =>
            (await subreddit.getModQueue({ type: "all" }).all()).map(queueItemOf),
        unmoderated: async (): Promise<readonly QueueItem[]> =>
            (await subreddit.getUnmoderated({ type: "all" }).all()).map(queueItemOf),
        reported: async (): Promise<readonly QueueItem[]> =>
            (await subreddit.getReports({ type: "all" }).all()).map(queueItemOf),
    };
}
