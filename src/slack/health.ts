import { failureDetail } from "./webApi.js";
import type { Delivery } from "./webApi.js";

/** A lasting problem delivering alerts, which the outbox reports rather than logging each alert it affects. */
export type DeliveryCondition =
    "slack-refusing" | "slack-unreachable" | "outbox-full" | "alerts-expired" | "redactions-failing";

/** What the outbox notes doing with alerts, for the health records. */
export type DeliveryEvent = "alert-delivered" | "alert-dropped" | "alert-redacted";

/**
 * Where the outbox reports delivery conditions: the composition root gives it the health log's. Neither function
 * rejects.
 */
export interface DeliveryHealth {
    /** The condition is in force; `detail` says what Slack answered. */
    readonly raise: (condition: DeliveryCondition, detail: string) => Promise<void>;
    readonly clear: (condition: DeliveryCondition) => Promise<void>;
    /** `count` alerts were delivered, or dropped. */
    readonly note: (event: DeliveryEvent, count: number) => Promise<void>;
}

/**
 * Reports what a drain's delivery of an alert says about Slack: an alert taken ends any problem, one refused means
 * Slack is refusing alerts, and one left for a later drain means Slack is not taking them for now.
 */
export async function reportDelivery(health: DeliveryHealth, delivery: Delivery<unknown>): Promise<void> {
    if (delivery.outcome === "delivered") {
        await health.note("alert-delivered", 1);
        await health.clear("slack-refusing");
        await health.clear("slack-unreachable");
        return;
    }
    if (delivery.outcome === "rejected") {
        await health.note("alert-dropped", 1);
    }
    await health.raise(
        delivery.outcome === "rejected" ? "slack-refusing" : "slack-unreachable",
        failureDetail(delivery.failure),
    );
}
