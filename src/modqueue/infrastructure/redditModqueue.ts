import type { Comment, Post, TriggerContext } from "@devvit/public-api";
import type { ModerationQueues } from "../application/ports.js";
import type { QueueItem } from "../domain/monitoring.js";

type QueuedContent = Readonly<Pick<Comment | Post, "createdAt" | "permalink">>;

function queueItemOf(content: QueuedContent): QueueItem {
    return {
        // Posts have a title; comments do not.
        kind: "title" in content ? "post" : "comment",
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
