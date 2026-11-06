import { CommentReport, PostReport } from "@devvit/protos/types/devvit/events/v1alpha/events.js";
import { SUBREDDIT } from "./fakeContext.js";

/**
 * Trigger events about what redditors do to content, shaped as Devvit delivers them: the protobuf messages, completed
 * with protobuf defaults, plus the trigger's `type`.
 */

export type ReportFields = Readonly<{ reason?: string; numReports?: number; ignoreReports?: boolean }>;

/** A report of Author's post t3_abc, with its reason ("Spam" unless given) and its reports so far (1 unless given). */
export function postReported(fields: ReportFields = {}): PostReport & Readonly<{ type: "PostReport" }> {
    return {
        type: "PostReport",
        ...PostReport.fromPartial({
            subreddit: { name: SUBREDDIT },
            reason: fields.reason ?? "Spam",
            post: {
                id: "t3_abc",
                title: "Hello world",
                permalink: "/r/testsub/comments/abc/hello_world/",
                authorId: "t2_author",
                numReports: fields.numReports ?? 1,
                ignoreReports: fields.ignoreReports ?? false,
            },
        }),
    };
}

/** A report of Commenter's comment t1_c on the post t3_abc, as for a post. */
export function commentReported(fields: ReportFields = {}): CommentReport & Readonly<{ type: "CommentReport" }> {
    return {
        type: "CommentReport",
        ...CommentReport.fromPartial({
            subreddit: { name: SUBREDDIT },
            reason: fields.reason ?? "Spam",
            comment: {
                id: "t1_c",
                postId: "t3_abc",
                body: "what the comment said",
                permalink: "/r/testsub/comments/abc/hello_world/c/",
                numReports: fields.numReports ?? 1,
            },
        }),
    };
}
