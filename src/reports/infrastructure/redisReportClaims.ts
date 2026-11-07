import type { TriggerContext } from "@devvit/public-api";
import type { ReportClaims } from "../application/ports.js";

/** A day's claims that an item's report alerts were sent: `reports:urgent:{itemId}` and `reports:pileup:{itemId}`. */
const CLAIM_SECONDS = 86_400;
const MS_PER_SECOND = 1000;

type ClaimRedis = Readonly<Pick<TriggerContext["redis"], "set">>;

/** One atomic SET NX; Redis answers an NX set that finds the key with nil, which Devvit returns as "". */
async function claim(redis: ClaimRedis, key: string): Promise<boolean> {
    return (
        (await redis.set(key, "1", { nx: true, expiration: new Date(Date.now() + CLAIM_SECONDS * MS_PER_SECOND) })) !==
        ""
    );
}

export function createRedisReportClaims(redis: ClaimRedis): ReportClaims {
    return {
        claimUrgent: async (itemId: string): Promise<boolean> => await claim(redis, `reports:urgent:${itemId}`),
        claimPileUp: async (itemId: string): Promise<boolean> => await claim(redis, `reports:pileup:${itemId}`),
    };
}
