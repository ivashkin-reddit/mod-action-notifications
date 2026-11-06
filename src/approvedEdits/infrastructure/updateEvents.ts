import type { ContentUpdate } from "../domain/approvedEdits.js";

type Author = Readonly<{ name: string }> | undefined;

/** What the app reads from a PostUpdate trigger event; Devvit's event type satisfies it. */
export type PostUpdateEvent = Readonly<{
    author?: Author;
    previousBody: string;
    post?: Readonly<{ id: string; permalink: string; selftext: string }> | undefined;
}>;

/** What the app reads from a CommentUpdate trigger event; Devvit's event type satisfies it. */
export type CommentUpdateEvent = Readonly<{
    author?: Author;
    previousBody: string;
    comment?: Readonly<{ id: string; permalink: string; body: string }> | undefined;
}>;

/** The update to a post. Its text is compared, never kept. */
export function updateFromPostEvent({ author, previousBody, post }: PostUpdateEvent): ContentUpdate {
    return {
        itemId: post?.id ?? "",
        kind: "post",
        author: author?.name ?? "",
        permalink: post?.permalink ?? "",
        textChanged: post !== undefined && post.selftext !== previousBody,
    };
}

/** The update to a comment. Its text is compared, never kept. */
export function updateFromCommentEvent({ author, previousBody, comment }: CommentUpdateEvent): ContentUpdate {
    return {
        itemId: comment?.id ?? "",
        kind: "comment",
        author: author?.name ?? "",
        permalink: comment?.permalink ?? "",
        textChanged: comment !== undefined && comment.body !== previousBody,
    };
}
