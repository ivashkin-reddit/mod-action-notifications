import type { HealthEvent } from "../domain/events.js";
import type { EventStore } from "./ports.js";

/**
 * Notes that `count` of the event happened now: when it last did, and how many today. Like a condition, it only
 * informs: when Redis fails, the work it describes goes on, and the failure is logged instead. Never rejects.
 */
export async function noteEvent(store: EventStore, event: HealthEvent, count: number): Promise<void> {
    try {
        await store.note(event, count, Date.now());
    } catch (error) {
        console.warn("[health] Could not record an event:", { event, error });
    }
}
