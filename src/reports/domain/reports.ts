/** A post or comment reported to the subreddit's moderators, as Reddit tells the app of it. */
export interface ContentReport {
    /** The post's or comment's ID; '' when the event names none. */
    readonly itemId: string;
    readonly kind: "post" | "comment";
    readonly permalink: string;
    /** How many times it has been reported, this report included. */
    readonly reportCount: number;
    /** The report's reason: a rule's name, Reddit's wording, or what the reporter typed. */
    readonly reason: string;
    /** Moderators chose to ignore its reports. */
    readonly ignoreReports: boolean;
}

/**
 * The configured reason a report's reason contains, ignoring case, as configured; undefined when none does. Matching
 * by containment lets a moderator write "personal information" for Reddit's longer wording.
 */
export function matchedReason(reason: string, configured: readonly string[]): string | undefined {
    const lower = reason.toLowerCase();
    return configured
        .map((candidate: string): string => candidate.trim())
        .find((candidate: string): boolean => candidate !== "" && lower.includes(candidate.toLowerCase()));
}

/** Whether a post's or comment's reports have piled up: at least the threshold, while the alert is on. */
export function isPileUp(reportCount: number, threshold: number): boolean {
    return threshold > 0 && reportCount >= threshold;
}
