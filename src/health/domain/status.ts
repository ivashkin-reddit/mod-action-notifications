import { conditionSummary } from "./conditions.js";
import type { InForce } from "./conditions.js";
import type { Counts, LastSeen } from "./events.js";

/**
 * What Show Bot Status tells moderators, who cannot read the app's logs: how the app is set up and doing, line by
 * line.
 */

/** The modqueue monitor: whether its settings turn it on, and what the scheduler holds for it. */
export type MonitorState =
    | Readonly<{ enabled: boolean; job: "none" | "one-off" | "unknown" }>
    | Readonly<{ enabled: boolean; job: "scheduled"; cron: string }>;

/** The alerts waiting for Slack: how many, and when the oldest was queued, in ms since the epoch. */
export type QueueState = Readonly<{ waiting: number; oldestQueuedAt: number | undefined }>;

/** What the status reports, gathered from the settings, the scheduler and Redis; undefined for what Redis could not give. */
export interface StatusInput {
    /** When the status is shown, in ms since the epoch. */
    readonly now: number;
    readonly version: string;
    readonly webhook: "set" | "missing" | "invalid";
    readonly monitor: MonitorState;
    readonly problems: readonly InForce[] | undefined;
    readonly queue: QueueState | undefined;
    readonly lastSeen: LastSeen | undefined;
    /** Today's counts, by UTC day. */
    readonly today: Counts | undefined;
}

/** One line of the status: what it is about, and what it says. */
export interface StatusLine {
    readonly label: string;
    readonly value: string;
}

const WEBHOOK_TEXT: Readonly<Record<StatusInput["webhook"], string>> = {
    set: "Set",
    missing: "Not set, so no alerts are sent",
    invalid: "Not a Slack webhook URL, so no alerts are sent",
};

const SET_UP = "Use Setup Modqueue Monitoring.";
const UNKNOWN = "Unknown: Redis could not be read";
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

function counted(count: number, unit: string): string {
    return `${String(count)} ${unit}${count === 1 ? "" : "s"}`;
}

/** A length of time in its largest whole unit, rounded down: "3 hours". */
export function durationText(ms: number): string {
    const minutes = Math.floor(ms / MS_PER_MINUTE);
    if (minutes < 1) {
        return "less than a minute";
    }
    const hours = Math.floor(minutes / MINUTES_PER_HOUR);
    if (hours < 1) {
        return counted(minutes, "minute");
    }
    const days = Math.floor(hours / HOURS_PER_DAY);
    return days < 1 ? counted(hours, "hour") : counted(days, "day");
}

function problemsText(problems: readonly InForce[] | undefined, now: number): string {
    if (problems === undefined) {
        return UNKNOWN;
    }
    return problems.length === 0
        ? "None"
        : problems
              .map(
                  (problem: InForce): string =>
                      `For ${durationText(now - problem.since)}: ${conditionSummary(problem)}`,
              )
              .join("\n");
}

const NONE_LATELY = "none in the last week";

/** How long ago `at` was; none in the last week when it is undefined. */
function ago(at: number | undefined, now: number): string {
    return at === undefined ? NONE_LATELY : `${durationText(now - at)} ago`;
}

function capitalised(text: string): string {
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function lastDeliveredText(lastSeen: LastSeen | undefined, now: number): string {
    return lastSeen === undefined ? UNKNOWN : capitalised(ago(lastSeen["alert-delivered"], now));
}

/** The monitor's latest run, and whether it failed: whichever of its last success and failure came later. */
function lastRunText(lastSeen: LastSeen | undefined, now: number): string {
    if (lastSeen === undefined) {
        return UNKNOWN;
    }
    const success = lastSeen["monitor-success"] ?? 0;
    const failure = lastSeen["monitor-failure"] ?? 0;
    if (success === 0 && failure === 0) {
        return capitalised(NONE_LATELY);
    }
    return failure > success ? `${ago(failure, now)}, failed` : `${ago(success, now)}, succeeded`;
}

function lastEventsText(lastSeen: LastSeen | undefined, now: number): string {
    if (lastSeen === undefined) {
        return UNKNOWN;
    }
    return [
        `Mod action: ${ago(lastSeen["mod-action"], now)}`,
        `Post deleted: ${ago(lastSeen["post-delete"], now)}`,
        `Comment deleted: ${ago(lastSeen["comment-delete"], now)}`,
    ].join("\n");
}

/** A day's counts in a line: mod actions, alerts delivered and dropped, monitor runs and failures. */
export function countsText(counts: Counts): string {
    const failures = counts["monitor-failure"] ?? 0;
    const runs = (counts["monitor-success"] ?? 0) + failures;
    return [
        counted(counts["mod-action"] ?? 0, "mod action"),
        `${counted(counts["alert-delivered"] ?? 0, "alert")} delivered, ${String(counts["alert-dropped"] ?? 0)} dropped`,
        `${counted(runs, "monitor run")}, ${String(failures)} failed`,
    ].join("; ");
}

function waitingText(queue: QueueState | undefined, now: number): string {
    if (queue === undefined) {
        return UNKNOWN;
    }
    if (queue.waiting === 0) {
        return "None";
    }
    const oldest =
        queue.oldestQueuedAt === undefined ? "" : `, the oldest for ${durationText(now - queue.oldestQueuedAt)}`;
    return `${String(queue.waiting)}${oldest}`;
}

function monitorText(monitor: MonitorState): string {
    if (monitor.job === "unknown") {
        return "Unknown: the scheduler could not be read";
    }
    if (!monitor.enabled) {
        return monitor.job === "none" ? "Off: all its thresholds are 0" : `Off, but still scheduled. ${SET_UP}`;
    }
    switch (monitor.job) {
        case "none": {
            return `On, but not scheduled. ${SET_UP}`;
        }
        case "one-off": {
            return "On, with a one-off run scheduled";
        }
        case "scheduled": {
            return `On, scheduled (cron ${monitor.cron})`;
        }
    }
}

export function statusLines(input: StatusInput): readonly StatusLine[] {
    return [
        { label: "App version", value: input.version },
        { label: "Slack webhook", value: WEBHOOK_TEXT[input.webhook] },
        { label: "Current problems", value: problemsText(input.problems, input.now) },
        { label: "Alerts waiting", value: waitingText(input.queue, input.now) },
        { label: "Last alert delivered", value: lastDeliveredText(input.lastSeen, input.now) },
        { label: "Modqueue monitor", value: monitorText(input.monitor) },
        { label: "Last monitor run", value: lastRunText(input.lastSeen, input.now) },
        { label: "Last events", value: lastEventsText(input.lastSeen, input.now) },
        { label: "Today (UTC)", value: input.today === undefined ? UNKNOWN : countsText(input.today) },
    ];
}
