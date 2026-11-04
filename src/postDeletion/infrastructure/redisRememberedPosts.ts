import type { TriggerContext } from "@devvit/public-api";
import type { RememberedPosts } from "../application/ports.js";
import type { RememberedPost } from "../domain/posts.js";

const MS_PER_SECOND = 1000;
/** A week: posts older than that are unlikely to be deleted. */
const RETENTION_SECONDS = 604_800;

type PostRedis = Readonly<Pick<TriggerContext["redis"], "get" | "set" | "del">>;

/** Installations already hold values under `post_score:{postId}`, with the fields of RememberedPost but `id`. */
function key(postId: string): string {
    return `post_score:${postId}`;
}

function text(value: unknown): string {
    return typeof value === "string" ? value : "";
}

/** The remembered post; rejects when what is stored is not a post with a numeric score. */
function rememberedPostOf(postId: string, stored: unknown): RememberedPost {
    if (typeof stored !== "object" || stored === null || !("score" in stored) || typeof stored.score !== "number") {
        throw new Error(`${key(postId)} does not hold a remembered post`);
    }
    return {
        id: postId,
        score: stored.score,
        title: "title" in stored ? text(stored.title) : "",
        authorName: "authorName" in stored ? text(stored.authorName) : "",
        permalink: "permalink" in stored ? text(stored.permalink) : "",
        subredditName: "subredditName" in stored ? text(stored.subredditName) : "",
    };
}

export function createRedisRememberedPosts(redis: PostRedis): RememberedPosts {
    return {
        remember: async ({ id, ...stored }: RememberedPost): Promise<void> => {
            await redis.set(key(id), JSON.stringify(stored), {
                expiration: new Date(Date.now() + RETENTION_SECONDS * MS_PER_SECOND),
            });
        },
        recall: async (postId: string): Promise<RememberedPost | undefined> => {
            const raw = await redis.get(key(postId));
            return raw === undefined || raw === "" ? undefined : rememberedPostOf(postId, JSON.parse(raw));
        },
        forget: async (postId: string): Promise<void> => {
            await redis.del(key(postId));
        },
    };
}
