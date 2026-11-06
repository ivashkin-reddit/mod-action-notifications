import type { ContentReport } from "../domain/reports.js";

/** What the app reads from a PostReport trigger event; Devvit's event type satisfies it. */
export type PostReportEvent = Readonly<{
    reason: string;
    post?: Readonly<{ id: string; permalink: string; numReports: number; ignoreReports: boolean }> | undefined;
}>;

/** What the app reads from a CommentReport trigger event; Devvit's event type satisfies it. */
export type CommentReportEvent = Readonly<{
    reason: string;
    comment?: Readonly<{ id: string; permalink: string; numReports: number }> | undefined;
}>;

export function reportFromPostEvent({ reason, post }: PostReportEvent): ContentReport {
    return {
        itemId: post?.id ?? "",
        kind: "post",
        permalink: post?.permalink ?? "",
        reportCount: post?.numReports ?? 0,
        reason,
        ignoreReports: post?.ignoreReports ?? false,
    };
}

/** A comment's report; Devvit's comment says nothing of ignored reports. */
export function reportFromCommentEvent({ reason, comment }: CommentReportEvent): ContentReport {
    return {
        itemId: comment?.id ?? "",
        kind: "comment",
        permalink: comment?.permalink ?? "",
        reportCount: comment?.numReports ?? 0,
        reason,
        ignoreReports: false,
    };
}
