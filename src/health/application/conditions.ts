import { conditionContinuing, conditionResolved, conditionStarted, REMINDER_SECONDS } from "../domain/conditions.js";
import type { Condition, InForce, LogLine } from "../domain/conditions.js";
import { NOTICE_PERIOD_SECONDS, noticeDue, problemNotice, resolvedNotice } from "../domain/notices.js";
import type { Notice } from "../domain/notices.js";
import type { ConditionStore, ModeratorNotices } from "./ports.js";

/** What a condition is recorded in, and where moderators are told of one. */
export type ConditionPorts = Readonly<{ store: ConditionStore; notices: ModeratorNotices }>;

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

/** Sends moderators a notice; when modmail cannot take it, logs that, as the work it is about goes on. */
async function tell({ notices }: ConditionPorts, condition: Condition, notice: Notice): Promise<boolean> {
    try {
        await notices.send(notice);
        return true;
    } catch (error) {
        console.warn("[health] Could not send moderators a modmail notice:", { condition, error });
        return false;
    }
}

async function end(ports: ConditionPorts, condition: Condition): Promise<void> {
    if (!(await ports.store.end(condition))) {
        return;
    }
    log(conditionResolved(condition));
    if (await ports.store.endNotice(condition)) {
        await tell(ports, condition, resolvedNotice(condition));
    }
}

/**
 * Notes that the condition is not in force, logging it when it has just ended, and telling moderators when they
 * were told it had started. Never rejects.
 */
export async function clearCondition(ports: ConditionPorts, condition: Condition): Promise<void> {
    await recording(condition, async (): Promise<void> => {
        await end(ports, condition);
    });
}

/**
 * Tells moderators of the condition, when it has lasted long enough and they were not told of it within the day. A
 * notice modmail could not take lets go of its claim, so the condition's next report tries again.
 */
async function noticeIfDue(ports: ConditionPorts, problem: InForce): Promise<void> {
    if (
        !noticeDue(problem.condition, problem.since, Date.now()) ||
        !(await ports.store.claimNotice(problem.condition, NOTICE_PERIOD_SECONDS))
    ) {
        return;
    }
    await ((await tell(ports, problem.condition, problemNotice(problem)))
        ? ports.store.recordNotice(problem.condition)
        : ports.store.releaseNotice(problem.condition));
}

async function start(ports: ConditionPorts, condition: Condition, detail: string): Promise<void> {
    const now = Date.now();
    const started = await ports.store.start(condition, now, detail);
    const reminder = await ports.store.claimReminder(condition, REMINDER_SECONDS);
    const since = started ? now : await ports.store.since(condition);
    if (started) {
        log(conditionStarted(condition, detail));
    } else if (reminder && since !== undefined) {
        log(conditionContinuing(condition, detail, since));
    }
    if (since !== undefined) {
        await noticeIfDue(ports, { condition, since, detail });
    }
}

/**
 * Notes that the condition is in force, logging it when it has just started, and then once a day; `detail` says what
 * the app saw of it. Never rejects.
 */
export async function raiseCondition(ports: ConditionPorts, condition: Condition, detail: string): Promise<void> {
    await recording(condition, async (): Promise<void> => {
        await start(ports, condition, detail);
    });
}
