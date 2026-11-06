import { tallyOf } from "../domain/counting.js";
import type { CountedAction } from "../domain/counting.js";
import type { StatisticsStore } from "./ports.js";

/**
 * Counts a mod action toward the team's statistics, once however often Devvit delivers it. An action without an ID
 * cannot be told apart from another, and is counted. Rejects when storage fails.
 */
export async function countModAction(action: CountedAction, store: StatisticsStore): Promise<void> {
    const id = action.id ?? "";
    if (id !== "" && !(await store.claimCount(id))) {
        return;
    }
    await store.addTally(tallyOf(action));
}
