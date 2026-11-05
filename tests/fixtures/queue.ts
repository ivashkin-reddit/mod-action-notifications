import { NOW } from "./app.js";
import type { QueueItem } from "./fakeContext.js";

const MS_PER_HOUR = 3_600_000;

function waitingSince(ageHours: number): Date {
    return new Date(NOW.getTime() - ageHours * MS_PER_HOUR);
}

/** A post that has waited in the modqueue for `ageHours` at NOW. */
export function queuedPost(id: string, ageHours: number): QueueItem {
    return {
        id: `t3_${id}`,
        title: `Post ${id}`,
        createdAt: waitingSince(ageHours),
        permalink: `/r/testsub/comments/${id}/`,
    };
}

/** A comment that has waited in the modqueue for `ageHours` at NOW. */
export function queuedComment(id: string, ageHours: number): QueueItem {
    return {
        id: `t1_${id}`,
        postId: "t3_p",
        createdAt: waitingSince(ageHours),
        permalink: `/r/testsub/comments/p/c/${id}/`,
    };
}

/** `size` posts that have only just arrived. */
export function freshQueue(size: number): readonly QueueItem[] {
    return Array.from({ length: size }, (_unused: unknown, index: number): QueueItem => queuedPost(String(index), 0));
}
