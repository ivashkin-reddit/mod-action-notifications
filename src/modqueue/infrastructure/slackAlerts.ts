import { escapeText, inChannel, withoutTitle } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type {
    AgedContentAlert,
    ModqueueAlerts,
    MonitorFailingAlert,
    QueueTooLongAlert,
    WatchedQueue,
} from "../application/ports.js";
import { hoursWaiting } from "../domain/monitoring.js";
import type { QueueItem } from "../domain/monitoring.js";

const MS_PER_SECOND = 1000;

function slackTimestamp(): number {
    return Math.floor(Date.now() / MS_PER_SECOND);
}

/** How each watched queue's size alert is titled. */
const QUEUE_TITLES: Readonly<Record<WatchedQueue, string>> = {
    modqueue: "Modqueue Alert",
    spam: "Spam Queue Alert",
    edited: "Edited Queue Alert",
};

function queueTooLongMessage({ queue, size, posts, comments, threshold }: QueueTooLongAlert): SlackMessage {
    return {
        text: `⚠️ ${QUEUE_TITLES[queue]}: ${String(size)} items pending`,
        attachments: [
            {
                color: "#ff9900",
                fields: [
                    { title: "📋 Queue Size", value: size.toString(), short: true },
                    { title: "📝 Posts", value: posts.toString(), short: true },
                    { title: "💬 Comments", value: comments.toString(), short: true },
                    { title: "🎯 Threshold", value: threshold.toString(), short: true },
                ],
                footer: "Mod Action Notifications - Modqueue Monitor",
                ts: slackTimestamp(),
            },
        ],
    };
}

function waitingItemLine(item: QueueItem, now: number): string {
    const type = item.kind === "post" ? "Post" : "Comment";
    return `• ${type} (${String(hoursWaiting(item, now))}h old): https://reddit.com${item.permalink}`;
}

/** How an age alert looks: its headline (given the count and the age limit), colour and footer. */
type AgedContentStyle = Readonly<{
    headline: (total: string, ageHours: string) => string;
    color: string;
    footer: string;
}>;

const UNMODERATED_STYLE: AgedContentStyle = {
    headline: (total: string, ageHours: string): string =>
        `⏰ Unmoderated Content Alert: ${total} items over ${ageHours}h old`,
    color: "#ff6600",
    footer: "Mod Action Notifications - Unmoderated Monitor",
};

const REPORTED_STYLE: AgedContentStyle = {
    headline: (total: string, ageHours: string): string =>
        `📣 Old Reported Content Alert: ${total} reported items over ${ageHours}h old`,
    color: "#cc3300",
    footer: "Mod Action Notifications - Reports Monitor",
};

function agedContentMessage(style: AgedContentStyle, { oldest, total, ageHours, now }: AgedContentAlert): SlackMessage {
    return {
        text: style.headline(String(total), String(ageHours)),
        attachments: [
            {
                color: style.color,
                fields: [
                    {
                        title: `📌 Oldest Items (showing ${String(oldest.length)} of ${String(total)})`,
                        value: oldest.map((item: QueueItem): string => waitingItemLine(item, now)).join("\n"),
                        short: false,
                    },
                ],
                footer: style.footer,
                ts: slackTimestamp(),
            },
        ],
    };
}

function monitorFailingMessage({ failures, error }: MonitorFailingAlert): SlackMessage {
    return {
        text: `⚠️ Critical: Modqueue Monitoring Failed ${String(failures)} Times`,
        attachments: [
            {
                color: "#ff0000",
                fields: [
                    { title: "❌ Status", value: "Scheduler job has failed repeatedly", short: true },
                    { title: "🔢 Failure Count", value: failures.toString(), short: true },
                    { title: "🔍 Error", value: error === "" ? "Unknown error" : escapeText(error), short: false },
                    { title: "⚙️ Action Required", value: "Check bot configuration and permissions", short: false },
                ],
                footer: "Mod Action Notifications - Scheduler Monitor",
                ts: slackTimestamp(),
            },
        ],
    };
}

/** The Reddit content an age alert links to, each link with a post's title in it: each item, and a comment's post. */
function linkedContent(items: readonly QueueItem[]): readonly string[] {
    return [...new Set(items.flatMap((item: QueueItem): readonly string[] => [item.id, item.postId]))];
}

/** The alert as it reads once content it links to is deleted: its links without the posts' titles. */
function withoutTitles(alert: AgedContentAlert): AgedContentAlert {
    return {
        ...alert,
        oldest: alert.oldest.map((item: QueueItem): QueueItem => ({
            ...item,
            permalink: withoutTitle(item.permalink),
        })),
    };
}

/**
 * Modqueue alerts as Slack messages, sent to the alert channel when one is set. An age alert names the content it
 * links to, with its version without the posts' titles, to be sent instead if any of it is deleted before it goes.
 */
export function createSlackModqueueAlerts(send: SlackSender, alertChannel: string): ModqueueAlerts {
    const sendAgedContent = async (style: AgedContentStyle, alert: AgedContentAlert): Promise<void> => {
        await send(inChannel(agedContentMessage(style, alert), alertChannel), {
            contentIds: linkedContent(alert.oldest),
            withoutQuotes: inChannel(agedContentMessage(style, withoutTitles(alert)), alertChannel),
        });
    };
    return {
        queueTooLong: async (alert: QueueTooLongAlert): Promise<void> => {
            await send(inChannel(queueTooLongMessage(alert), alertChannel));
        },
        waitingTooLong: async (alert: AgedContentAlert): Promise<void> => {
            await sendAgedContent(UNMODERATED_STYLE, alert);
        },
        reportedContentOld: async (alert: AgedContentAlert): Promise<void> => {
            await sendAgedContent(REPORTED_STYLE, alert);
        },
        monitorFailing: async (alert: MonitorFailingAlert): Promise<void> => {
            await send(inChannel(monitorFailingMessage(alert), alertChannel));
        },
    };
}
