import { tallyOf } from "../domain/counting.js";
import type { CountedAction } from "../domain/counting.js";
import { settleModAction } from "./responses.js";
import type { ResponsePorts } from "./responses.js";

/**
 * Counts a mod action toward the team's statistics, once however often Devvit delivers it, and settles the item it
 * removes or approves. An action without an ID cannot be told apart from another, and is counted. Rejects when
 * storage fails.
 */
export async function countModAction(action: CountedAction, ports: ResponsePorts): Promise<void> {
    const id = action.id ?? "";
    if (id !== "" && !(await ports.store.claimCount(id))) {
        return;
    }
    await ports.store.addTally(tallyOf(action));
    await settleModAction(action, ports);
}
