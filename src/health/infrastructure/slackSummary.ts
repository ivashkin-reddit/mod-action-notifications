import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type { DailySummary } from "../domain/summary.js";

const MS_PER_SECOND = 1000;

function summaryMessage({ day, lines }: DailySummary): SlackMessage {
    return {
        text: `📊 Daily summary for ${day} (UTC)`,
        attachments: [
            {
                color: "#0088ff",
                text: lines
                    .map(
                        ({ label, value }: Readonly<{ label: string; value: string }>): string =>
                            `• *${label}:* ${value}`,
                    )
                    .join("\n"),
                mrkdwn_in: ["text"],
                footer: "Mod Action Notifications - Daily Summary",
                ts: Math.floor(Date.now() / MS_PER_SECOND),
            },
        ],
    };
}

/** The daily summary as a Slack message to the notification channel, handed to `send`, which queues it. */
export function createSlackSummary(send: SlackSender): (summary: DailySummary) => Promise<void> {
    return async (summary: DailySummary): Promise<void> => {
        await send(summaryMessage(summary));
    };
}
