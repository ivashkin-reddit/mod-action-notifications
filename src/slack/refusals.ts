import type { TriggerContext } from "@devvit/public-api";
import type { Delivery } from "./webApi.js";

type RefusalRedis = Readonly<Pick<TriggerContext["redis"], "get" | "set" | "del">>;

/** The channel Slack last refused an alert to, for a day: `slack_outbox_refusing`. */
const REFUSING_KEY = "slack_outbox_refusing";
const REFUSING_MS = 86_400_000;

/**
 * Notes the channel Slack refused an alert to, and says whether an alert Slack took ends the refusal: one to that
 * channel does, or any once none is noted. The Slack app can be in one channel and not another, so an alert taken
 * in one says nothing of the other. A read, then a write: only the drain holding the lease reports deliveries.
 */
export async function endsRefusal(redis: RefusalRedis, delivery: Delivery<unknown>, channel: string): Promise<boolean> {
    if (delivery.outcome === "rejected") {
        await redis.set(REFUSING_KEY, channel, { expiration: new Date(Date.now() + REFUSING_MS) });
        return false;
    }
    if (delivery.outcome !== "delivered") {
        return false;
    }
    const refusing = await redis.get(REFUSING_KEY);
    if (refusing !== undefined && refusing !== channel) {
        return false;
    }
    await redis.del(REFUSING_KEY);
    return true;
}
