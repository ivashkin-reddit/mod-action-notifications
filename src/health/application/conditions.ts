import { conditionContinuing, conditionResolved, conditionStarted, REMINDER_SECONDS } from "../domain/conditions.js";
import type { Condition, LogLine } from "../domain/conditions.js";
import type { ConditionStore } from "./ports.js";

function log({ level, text }: LogLine): void {
    switch (level) {
        case "error": {
            console.error(text);
            return;
        }
        case "warn": {
            console.warn(text);
            return;
        }
        case "info": {
            console.info(text);
        }
    }
}

/**
 * Runs `record`, which keeps a condition in Redis. A condition only informs the log and the moderators, so when
 * Redis fails, the work it describes goes on: the failure is logged instead.
 */
async function recording(condition: Condition, record: () => Promise<void>): Promise<void> {
    try {
        await record();
    } catch (error) {
        console.warn("[health] Could not record a condition:", { condition, error });
    }
}

async function end(store: ConditionStore, condition: Condition): Promise<void> {
    if (await store.end(condition)) {
        log(conditionResolved(condition));
    }
}

/** Notes that the condition is not in force, logging it when it has just ended. Never rejects. */
export async function clearCondition(store: ConditionStore, condition: Condition): Promise<void> {
    await recording(condition, async (): Promise<void> => {
        await end(store, condition);
    });
}

async function start(store: ConditionStore, condition: Condition, detail: string): Promise<void> {
    const started = await store.start(condition, Date.now(), detail);
    const reminder = await store.claimReminder(condition, REMINDER_SECONDS);
    if (started) {
        log(conditionStarted(condition, detail));
        return;
    }
    const since = reminder ? await store.since(condition) : undefined;
    if (since !== undefined) {
        log(conditionContinuing(condition, detail, since));
    }
}

/**
 * Notes that the condition is in force, logging it when it has just started, and then once a day; `detail` says what
 * the app saw of it. Never rejects.
 */
export async function raiseCondition(store: ConditionStore, condition: Condition, detail: string): Promise<void> {
    await recording(condition, async (): Promise<void> => {
        await start(store, condition, detail);
    });
}
