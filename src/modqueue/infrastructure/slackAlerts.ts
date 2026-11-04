import { inChannel } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type {
    ModqueueAlerts,
    MonitorFailingAlert,
    QueueTooLongAlert,
    WaitingTooLongAlert,
} from "../application/ports.js";
import { hoursWaiting } from "../domain/monitoring.js";
import type { QueueItem } from "../domain/monitoring.js";

const MS_PER_SECOND = 1000;

function slackTimestamp(): number {
    return Math.floor(Date.now() / MS_PER_SECOND);
}

function queueTooLongMessage({ size, posts, comments, threshold }: QueueTooLongAlert): SlackMessage {
    return {
        text: `⚠️ Modqueue Alert: ${String(size)} items pending`,
        username: "Reddit Mod Bot",
        icon_emoji: ":warning:",
        attachments: [
            {
                color: "#ff9900",
                fields: [
                    { title: "📋 Queue Size", value: size.toString(), short: true },
                    { title: "📝 Posts", value: posts.toString(), short: true },
                    { title: "💬 Comments", value: comments.toString(), short: true },
                    { title: "🎯 Threshold", value: threshold.toString(), short: true },
                ],
                footer: "Reddit Mod Action Bot - Modqueue Monitor",
                ts: slackTimestamp(),
            },
        ],
    };
}

function waitingItemLine(item: QueueItem, now: number): string {
    const type = item.kind === "post" ? "Post" : "Comment";
    return `• ${type} (${String(hoursWaiting(item, now))}h old): https://reddit.com${item.permalink}`;
}

function waitingTooLongMessage({ oldest, total, ageHours, now }: WaitingTooLongAlert): SlackMessage {
    return {
        text: `⏰ Unmoderated Content Alert: ${String(total)} items over ${String(ageHours)}h old`,
        username: "Reddit Mod Bot",
        icon_emoji: ":alarm_clock:",
        attachments: [
            {
                color: "#ff6600",
                fields: [
                    {
                        title: `📌 Oldest Items (showing ${String(oldest.length)} of ${String(total)})`,
                        value: oldest.map((item: QueueItem): string => waitingItemLine(item, now)).join("\n"),
                        short: false,
                    },
                ],
                footer: "Reddit Mod Action Bot - Unmoderated Monitor",
                ts: slackTimestamp(),
            },
        ],
    };
}

function monitorFailingMessage({ failures, error }: MonitorFailingAlert): SlackMessage {
    return {
        text: `⚠️ Critical: Modqueue Monitoring Failed ${String(failures)} Times`,
        username: "Reddit Mod Bot",
        icon_emoji: ":warning:",
        attachments: [
            {
                color: "#ff0000",
                fields: [
                    { title: "❌ Status", value: "Scheduler job has failed repeatedly", short: true },
                    { title: "🔢 Failure Count", value: failures.toString(), short: true },
                    { title: "🔍 Error", value: error === "" ? "Unknown error" : error, short: false },
                    { title: "⚙️ Action Required", value: "Check bot configuration and permissions", short: false },
                ],
                footer: "Reddit Mod Action Bot - Scheduler Monitor",
                ts: slackTimestamp(),
            },
        ],
    };
}

/** Modqueue alerts as Slack messages, sent to the alert channel when one is set. */
export function createSlackModqueueAlerts(send: SlackSender, alertChannel: string): ModqueueAlerts {
    return {
        queueTooLong: async (alert: QueueTooLongAlert): Promise<void> => {
            await send(inChannel(queueTooLongMessage(alert), alertChannel));
        },
        waitingTooLong: async (alert: WaitingTooLongAlert): Promise<void> => {
            await send(inChannel(waitingTooLongMessage(alert), alertChannel));
        },
        monitorFailing: async (alert: MonitorFailingAlert): Promise<void> => {
            await send(inChannel(monitorFailingMessage(alert), alertChannel));
        },
    };
}
