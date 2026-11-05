import type { TriggerContext } from "@devvit/public-api";
import type { T3 } from "@devvit/shared-types/tid.js";
import type { PostLookup } from "../application/ports.js";
import type { DeletedPost } from "../domain/posts.js";

type PostReddit = Readonly<Pick<TriggerContext["reddit"], "getPostById">>;

function isPostId(id: string): id is T3 {
    return id.startsWith("t3_");
}

export function createRedditPostLookup(reddit: PostReddit): PostLookup {
    return {
        deletedPost: async (postId: string): Promise<DeletedPost> => {
            if (!isPostId(postId)) {
                throw new Error(`${postId} is not a post ID`);
            }
            const post = await reddit.getPostById(postId);
            return {
                score: post.score,
                title: post.title,
                permalink: post.permalink,
                subredditName: post.subredditName,
            };
        },
    };
}
