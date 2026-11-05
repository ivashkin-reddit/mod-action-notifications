import {
    DeletionReason,
    EventSource as DeletionSource,
    PostDelete,
} from "@devvit/protos/types/devvit/events/v1alpha/events.js";
import { ModAction } from "@devvit/protos/types/devvit/reddit/v2alpha/modaction.js";
import { SUBREDDIT } from "./fakeContext.js";
import type { FakePost } from "./fakeContext.js";

/** DeletionSource is Devvit's EventSource, renamed: the WebWorker lib already has a global EventSource. */
export { DeletionReason, DeletionSource };

/**
 * Trigger events shaped exactly as Devvit delivers them: the protobuf messages, completed with protobuf defaults
 * (empty strings, zeroes) for every field a test leaves out, plus the trigger's `type`.
 */

type Named = Readonly<{ name: string }> | undefined;

export type ModActionFields = Readonly<{
    id?: string | undefined;
    action?: string;
    actionedAt?: Date;
    subreddit?: Named;
    moderator?: Named;
    targetUser?: Named;
    targetPost?:
        Readonly<{ id?: string; title?: string; selftext?: string; permalink?: string; authorId?: string }> | undefined;
    targetComment?: Readonly<{ id?: string; body?: string; permalink?: string; author?: string }> | undefined;
}>;

export type PostDeleteFields = Readonly<{
    postId?: string;
    source?: DeletionSource;
    reason?: DeletionReason;
    deletedAt?: Date | undefined;
    author?: Named;
    subreddit?: Named;
}>;

export function modActionEvent(fields: ModActionFields): ModAction & Readonly<{ type: "ModAction" }> {
    return { type: "ModAction", ...ModAction.fromPartial({ subreddit: { name: SUBREDDIT }, ...fields }) };
}

export function postDeleteEvent(fields: PostDeleteFields): PostDelete & Readonly<{ type: "PostDelete" }> {
    return { type: "PostDelete", ...PostDelete.fromPartial({ subreddit: { name: SUBREDDIT }, ...fields }) };
}

// Fixtures: the events most tests start from.

/** ModA removes Author's post. */
export function removedPost(fields: ModActionFields = {}): ReturnType<typeof modActionEvent> {
    return modActionEvent({
        action: "removelink",
        moderator: { name: "ModA" },
        targetUser: { name: "Author" },
        targetPost: {
            id: "t3_abc",
            title: "Hello world",
            permalink: "/r/testsub/comments/abc/hello_world/",
            authorId: "t2_author",
        },
        ...fields,
    });
}

/** ModA bans Troll. */
export function bannedUser(fields: ModActionFields = {}): ReturnType<typeof modActionEvent> {
    return modActionEvent({ action: "banuser", moderator: { name: "ModA" }, targetUser: { name: "Troll" }, ...fields });
}

/** Poster's post t3_big with the given score, as Reddit returns it. */
export function bigPost(score: number): FakePost {
    return {
        id: "t3_big",
        title: "Big post",
        score,
        permalink: "/r/testsub/comments/big/big_post/",
        subredditName: SUBREDDIT,
    };
}

/** Poster deletes their own post t3_big. */
export function userDeletion(fields: PostDeleteFields = {}): ReturnType<typeof postDeleteEvent> {
    return postDeleteEvent({
        postId: "t3_big",
        source: DeletionSource.USER,
        reason: DeletionReason.OTHER,
        deletedAt: new Date("2026-11-04T13:00:00Z"),
        author: { name: "Poster" },
        ...fields,
    });
}
