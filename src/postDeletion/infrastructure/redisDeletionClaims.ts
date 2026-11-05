import type { TriggerContext } from "@devvit/public-api";
import type { DeletionAlertClaims } from "../application/ports.js";

const MS_PER_SECOND = 1000;
/** How long an alerted deletion is remembered, so that Devvit delivering it again sends no second alert. A day. */
const ALERT_MEMORY_SECONDS = 86_400;

type ClaimRedis = Readonly<Pick<TriggerContext["redis"], "set">>;

/** Present while a deletion of the post with this ID has been alerted within the last day. */
function alertedKey(postId: string): string {
    return `post_deletion:alerted:${postId}`;
}

export function createRedisDeletionClaims(redis: ClaimRedis): DeletionAlertClaims {
    return {
        // One atomic SET NX, so deliveries of one deletion handled at once cannot both claim its alert. Redis answers
        // an NX set that finds the key with nil, which Devvit returns as "".
        claim: async (postId: string): Promise<boolean> =>
            (await redis.set(alertedKey(postId), "1", {
                nx: true,
                expiration: new Date(Date.now() + ALERT_MEMORY_SECONDS * MS_PER_SECOND),
            })) !== "",
    };
}
