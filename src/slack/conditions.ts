import { failureDetail } from "./webhook.js";
import type { Delivery } from "./webhook.js";

/** A lasting problem delivering alerts, which the outbox reports rather than logging each alert it affects. */
export type DeliveryCondition = "slack-refusing" | "slack-unreachable";

/**
 * Where the outbox reports delivery conditions: the composition root gives it the health log's. Neither function
 * rejects.
 */
export interface DeliveryConditions {
    /** The condition is in force; `detail` says what Slack answered. */
    readonly raise: (condition: DeliveryCondition, detail: string) => Promise<void>;
    readonly clear: (condition: DeliveryCondition) => Promise<void>;
}

/**
 * Reports what a drain's delivery of an alert says about Slack: an alert taken ends any problem, one refused means
 * Slack is refusing alerts, and one left for a later drain means Slack is not taking them for now.
 */
export async function reportDelivery(conditions: DeliveryConditions, delivery: Delivery): Promise<void> {
    if (delivery.outcome === "delivered") {
        await conditions.clear("slack-refusing");
        await conditions.clear("slack-unreachable");
        return;
    }
    await conditions.raise(
        delivery.outcome === "rejected" ? "slack-refusing" : "slack-unreachable",
        failureDetail(delivery.failure),
    );
}
