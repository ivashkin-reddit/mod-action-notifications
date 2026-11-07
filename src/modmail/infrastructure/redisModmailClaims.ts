import type { TriggerContext } from "@devvit/public-api";
import type { ModmailClaims } from "../application/ports.js";

/** A day's claim that a message's admin alert was sent: `modmail:admin:{messageId}`. */
const ADMIN_CLAIM_SECONDS = 86_400;
/** The waiting alert's throttle: `modmail:throttle:waiting`. */
const WAITING_KEY = "modmail:throttle:waiting";
const MS_PER_SECOND = 1000;

type ClaimRedis = Readonly<Pick<TriggerContext["redis"], "set">>;

/** One atomic SET NX; Redis answers an NX set that finds the key with nil, which Devvit returns as "". */
async function claim(redis: ClaimRedis, key: string, seconds: number): Promise<boolean> {
    return (await redis.set(key, "1", { nx: true, expiration: new Date(Date.now() + seconds * MS_PER_SECOND) })) !== "";
}

export function createRedisModmailClaims(redis: ClaimRedis): ModmailClaims {
    return {
        claimAdminAlert: async (messageId: string): Promise<boolean> =>
            await claim(redis, `modmail:admin:${messageId}`, ADMIN_CLAIM_SECONDS),
        claimWaitingAlert: async (periodSeconds: number): Promise<boolean> =>
            await claim(redis, WAITING_KEY, periodSeconds),
    };
}
