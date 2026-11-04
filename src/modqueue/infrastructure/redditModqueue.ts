import type { Comment, Post, TriggerContext } from "@devvit/public-api";
import type { Modqueue } from "../application/ports.js";
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

/** Opens the current subreddit's modqueue; rejects when the subreddit cannot be read. */
export async function openRedditModqueue(
    reddit: Readonly<Pick<TriggerContext["reddit"], "getCurrentSubreddit">>,
): Promise<Modqueue> {
    const subreddit = await reddit.getCurrentSubreddit();
    return {
        items: async (): Promise<readonly QueueItem[]> => {
            const listing = subreddit.getModQueue({ type: "all" });
            return (await listing.all()).map(queueItemOf);
        },
    };
}
