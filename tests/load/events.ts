import {
    AutomoderatorFilterComment,
    CommentDelete,
    CommentReport,
    CommentUpdate,
    DeletionReason,
    EventSource as DeletionSource,
    PostDelete,
    PostReport,
    PostUpdate,
} from "@devvit/protos/types/devvit/events/v1alpha/events.js";
import { ModAction } from "@devvit/protos/types/devvit/reddit/v2alpha/modaction.js";
import { ModMail } from "@devvit/protos/types/devvit/reddit/v2alpha/modmail.js";
import { SUBREDDIT } from "../fixtures/fakeContext.js";
import { MODERATORS } from "./harness.js";

/**
 * A subreddit's event stream, as Devvit delivers it to the app's triggers: comment edits and deletions dominate, then
 * mod actions (AutoModerator's among them), reports, posts and modmail. Authors and posts are reused unevenly: a few
 * prolific authors and one busy thread take a large share. Content lengths vary, a few comments very long.
 */

/** The kinds of event the app handles, and how often each comes in the steady mix (weights, summing to 100). */
export const STEADY_MIX = {
    commentEdit: 30,
    commentDelete: 20,
    modAction: 25,
    commentReport: 10,
    commentFiltered: 5,
    postEdit: 3,
    postDelete: 3,
    postReport: 2,
    modmail: 2,
} as const;

export type EventKind = keyof typeof STEADY_MIX;

const KINDS: readonly EventKind[] = [
    "commentEdit",
    "commentDelete",
    "modAction",
    "commentReport",
    "commentFiltered",
    "postEdit",
    "postDelete",
    "postReport",
    "modmail",
];
export type Mix = Readonly<Record<EventKind, number>>;

/** A generated event: the trigger it goes to, and the event itself. */
export type GeneratedEvent = Readonly<{ type: string; event: unknown; kind: EventKind; id: string }>;

/** How a stream reuses authors and posts. */
export type Shape = Readonly<{
    authors: number;
    posts: number;
    /** The share of comments on the busiest post. */
    hotPostShare: number;
    /** The share of events by the most prolific author. */
    hotAuthorShare: number;
}>;

export const REALISTIC_SHAPE: Shape = { authors: 2000, posts: 200, hotPostShare: 0.3, hotAuthorShare: 0.02 };

/** Park and Miller's minimal standard generator, seeded: a stream is the same each run. */
export function seededRandom(seed: number): () => number {
    const modulus = 2_147_483_647;
    let state = Math.max(1, Math.floor(seed) % modulus);
    return (): number => {
        state = (state * 48_271) % modulus;
        return (state - 1) / (modulus - 1);
    };
}

/** The mod actions a busy subreddit sees, by weight, and who takes them. */
const ACTIONS: readonly (readonly [string, number])[] = [
    ["removecomment", 40],
    ["approvecomment", 15],
    ["removelink", 10],
    ["spamcomment", 10],
    ["automod-removecomment", 15],
    ["banuser", 3],
    ["lock", 4],
    ["editflair", 3],
];

/** Picks by weight. */
function weighted<T>(random: () => number, choices: readonly (readonly [T, number])[]): T {
    const total = choices.reduce((sum: number, [, weight]: readonly [T, number]): number => sum + weight, 0);
    let pick = random() * total;
    for (const [choice, weight] of choices) {
        pick -= weight;
        if (pick < 0) {
            return choice;
        }
    }
    const [last] = choices.slice(-1);
    if (last === undefined) {
        throw new Error("no choices");
    }
    return last[0];
}

/** A body: mostly short, sometimes long, rarely 10,000 characters. */
function body(random: () => number): string {
    const roll = random();
    if (roll < 0.01) {
        return "x".repeat(10_000);
    }
    return "x".repeat(roll < 0.1 ? 1500 : 20 + Math.floor(random() * 300));
}

export type EventStream = Readonly<{ next: (kind?: EventKind) => GeneratedEvent; comments: () => number }>;

/** A stream of events for a subreddit with the given mix and shape. */
export function createEventStream(mix: Mix, shape: Shape, seed = 1): EventStream {
    const random = seededRandom(seed);
    let sequence = 0;
    const comments: string[] = [];
    const nextId = (): string => {
        sequence += 1;
        return sequence.toString(36);
    };
    const author = (): string => {
        const index = random() < shape.hotAuthorShare ? 0 : Math.floor(shape.authors * random() ** 2);
        return `author${String(index)}`;
    };
    const post = (): string => {
        const index = random() < shape.hotPostShare ? 0 : Math.floor(shape.posts * random());
        return `t3_p${String(index)}`;
    };
    /** An existing comment, half the time; else a new one, on a post. */
    const comment = (): Readonly<{ id: string; postId: string }> => {
        const known = comments[Math.floor(random() * comments.length)];
        if (known !== undefined && random() < 0.5) {
            const [id = "", postId = ""] = known.split("@");
            return { id, postId };
        }
        const created = { id: `t1_${nextId()}`, postId: post() };
        comments.push(`${created.id}@${created.postId}`);
        return created;
    };
    const permalink = (postId: string, commentId?: string): string =>
        `/r/${SUBREDDIT}/comments/${postId.slice(3)}/a_title/${commentId === undefined ? "" : `${commentId.slice(3)}/`}`;
    const builders: Readonly<Record<EventKind, () => GeneratedEvent>> = {
        commentEdit: (): GeneratedEvent => {
            const target = comment();
            const name = author();
            return {
                type: "CommentUpdate",
                kind: "commentEdit",
                id: target.id,
                event: CommentUpdate.fromPartial({
                    subreddit: { name: SUBREDDIT },
                    author: { id: `t2_${name}`, name },
                    previousBody: body(random),
                    comment: {
                        id: target.id,
                        postId: target.postId,
                        body: body(random),
                        permalink: permalink(target.postId, target.id),
                    },
                }),
            };
        },
        commentDelete: (): GeneratedEvent => {
            const target = comment();
            return {
                type: "CommentDelete",
                kind: "commentDelete",
                id: target.id,
                event: CommentDelete.fromPartial({
                    subreddit: { name: SUBREDDIT },
                    commentId: target.id,
                    postId: target.postId,
                    source: DeletionSource.USER,
                    reason: DeletionReason.OTHER,
                    deletedAt: new Date(),
                    author: { name: author() },
                }),
            };
        },
        modAction: (): GeneratedEvent => {
            const choice = weighted(random, ACTIONS);
            const automod = choice.startsWith("automod-");
            const action = automod ? choice.slice("automod-".length) : choice;
            const target = comment();
            const id = `ModAction_${nextId()}`;
            const onPost = action === "removelink" || action === "lock" || action === "editflair";
            return {
                type: "ModAction",
                kind: "modAction",
                id,
                event: ModAction.fromPartial({
                    id,
                    action,
                    actionedAt: new Date(),
                    subreddit: { name: SUBREDDIT },
                    moderator: {
                        name: automod
                            ? "AutoModerator"
                            : (MODERATORS[Math.floor(random() * MODERATORS.length)] ?? "ModA"),
                    },
                    targetUser: { name: author() },
                    ...(onPost
                        ? {
                              targetPost: {
                                  id: target.postId,
                                  title: "A title",
                                  permalink: permalink(target.postId),
                                  authorId: "t2_x",
                              },
                          }
                        : {
                              targetComment: {
                                  id: target.id,
                                  postId: target.postId,
                                  body: body(random),
                                  permalink: permalink(target.postId, target.id),
                                  author: author(),
                              },
                          }),
                }),
            };
        },
        commentReport: (): GeneratedEvent => {
            const target = comment();
            return {
                type: "CommentReport",
                kind: "commentReport",
                id: target.id,
                event: CommentReport.fromPartial({
                    subreddit: { name: SUBREDDIT },
                    reason: random() < 0.02 ? "threat" : "Spam",
                    comment: {
                        id: target.id,
                        postId: target.postId,
                        body: body(random),
                        permalink: permalink(target.postId, target.id),
                        numReports: 1 + Math.floor(random() * 6),
                    },
                }),
            };
        },
        commentFiltered: (): GeneratedEvent => {
            const target = comment();
            return {
                type: "AutomoderatorFilterComment",
                kind: "commentFiltered",
                id: target.id,
                event: AutomoderatorFilterComment.fromPartial({
                    subreddit: { name: SUBREDDIT },
                    reason: "Matched a rule",
                    author: author(),
                    comment: {
                        id: target.id,
                        postId: target.postId,
                        body: body(random),
                        permalink: permalink(target.postId, target.id),
                    },
                }),
            };
        },
        postEdit: (): GeneratedEvent => {
            const postId = post();
            const name = author();
            return {
                type: "PostUpdate",
                kind: "postEdit",
                id: postId,
                event: PostUpdate.fromPartial({
                    subreddit: { name: SUBREDDIT },
                    author: { id: `t2_${name}`, name },
                    previousBody: body(random),
                    post: {
                        id: postId,
                        title: "A title",
                        selftext: body(random),
                        permalink: permalink(postId),
                        authorId: `t2_${name}`,
                    },
                }),
            };
        },
        postDelete: (): GeneratedEvent => {
            const postId = `t3_d${nextId()}`;
            return {
                type: "PostDelete",
                kind: "postDelete",
                id: postId,
                event: PostDelete.fromPartial({
                    subreddit: { name: SUBREDDIT },
                    postId,
                    source: DeletionSource.USER,
                    reason: DeletionReason.OTHER,
                    deletedAt: new Date(),
                    author: { name: author() },
                }),
            };
        },
        postReport: (): GeneratedEvent => {
            const postId = post();
            return {
                type: "PostReport",
                kind: "postReport",
                id: postId,
                event: PostReport.fromPartial({
                    subreddit: { name: SUBREDDIT },
                    reason: "Spam",
                    post: {
                        id: postId,
                        title: "A title",
                        permalink: permalink(postId),
                        authorId: "t2_x",
                        numReports: 1 + Math.floor(random() * 6),
                    },
                }),
            };
        },
        modmail: (): GeneratedEvent => {
            const fromModerator = random() < 0.4;
            const conversation = `ModmailConversation_${String(Math.floor(random() * 300))}`;
            const id = `ModmailMessage_${nextId()}`;
            return {
                type: "ModMail",
                kind: "modmail",
                id,
                event: ModMail.fromPartial({
                    messageAuthor: { id: "t2_someone", name: fromModerator ? "ModA" : author() },
                    messageAuthorType: fromModerator ? "moderator" : "participant_user",
                    conversationState: "new",
                    createdAt: new Date(),
                    conversationType: "sr_user",
                    isAutoGenerated: false,
                    conversationSubreddit: { name: SUBREDDIT },
                    conversationId: conversation,
                    messageId: id,
                }),
            };
        },
    };
    const kinds = KINDS.map((kind: EventKind): readonly [EventKind, number] => [kind, mix[kind]]);
    return {
        next: (kind?: EventKind): GeneratedEvent => builders[kind ?? weighted(random, kinds)](),
        comments: (): number => comments.length,
    };
}
