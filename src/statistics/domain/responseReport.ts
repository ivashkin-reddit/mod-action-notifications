import { BUCKETS } from "./responses.js";
import type { ResponseBucket } from "./responses.js";

/** How the team responded over a period: to the queue, to modmail, and to removals it reversed. */
export interface ResponseReport {
    /** Items moderators removed or approved after a report or AutoModerator's filter, and their median wait's bucket. */
    readonly queue: Readonly<{ handled: number; median: ResponseBucket | undefined }>;
    readonly reported: Readonly<{ removed: number; approved: number }>;
    /** AutoModerator's filtered items: those approved were its false positives. */
    readonly filtered: Readonly<{ removed: number; approved: number }>;
    readonly reversals: Readonly<{ reddit: number; moderator: number }>;
    /** Moderators' replies to users waiting in modmail, and their median wait's bucket. */
    readonly modmail: Readonly<{ replies: number; median: ResponseBucket | undefined }>;
}

type Tally = Readonly<Record<string, number>>;

/** The median is the first bucket by which half the responses are counted. */
const HALF = 0.5;

/** How many responses, and the bucket the middle one falls in, from the counts of `{prefix}:{bucket}`. */
function bucketsOf(outcomes: Tally, prefix: string): Readonly<{ count: number; median: ResponseBucket | undefined }> {
    const counts = BUCKETS.map((bucket: ResponseBucket): number => outcomes[`${prefix}:${bucket}`] ?? 0);
    const count = counts.reduce((sum: number, each: number): number => sum + each, 0);
    const median = BUCKETS.find(
        (_bucket: ResponseBucket, index: number): boolean =>
            count > 0 &&
            counts.slice(0, index + 1).reduce((sum: number, each: number): number => sum + each, 0) >= count * HALF,
    );
    return { count, median };
}

/** The response report from a period's summed outcome counts. */
export function responseReport(outcomes: Tally): ResponseReport {
    const queue = bucketsOf(outcomes, "queue");
    const modmail = bucketsOf(outcomes, "modmail");
    return {
        queue: { handled: queue.count, median: queue.median },
        reported: { removed: outcomes["report:removed"] ?? 0, approved: outcomes["report:approved"] ?? 0 },
        filtered: {
            removed: outcomes["automoderator:removed"] ?? 0,
            approved: outcomes["automoderator:approved"] ?? 0,
        },
        reversals: { reddit: outcomes["reversed:reddit"] ?? 0, moderator: outcomes["reversed:moderator"] ?? 0 },
        modmail: { replies: modmail.count, median: modmail.median },
    };
}
