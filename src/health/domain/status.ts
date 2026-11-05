/**
 * What Show Bot Status tells moderators, who cannot read the app's logs: how the app is set up and doing, line by
 * line.
 */

/** The modqueue monitor: whether its settings turn it on, and what the scheduler holds for it. */
export type MonitorState =
    | Readonly<{ enabled: boolean; job: "none" | "one-off" | "unknown" }>
    | Readonly<{ enabled: boolean; job: "scheduled"; cron: string }>;

/** What the status reports, gathered from the settings, the scheduler and Redis. */
export interface StatusInput {
    readonly version: string;
    readonly webhook: "set" | "missing" | "invalid";
    readonly monitor: MonitorState;
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
        { label: "Modqueue monitor", value: monitorText(input.monitor) },
    ];
}
