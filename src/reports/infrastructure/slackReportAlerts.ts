import { escapeText, withoutTitle } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type { ReportAlerts } from "../application/ports.js";
import type { ContentReport } from "../domain/reports.js";

const MS_PER_SECOND = 1000;

/** A link to the item without the post's title in it; none without a permalink. */
function contentLines({ kind, permalink }: ContentReport): readonly string[] {
    return permalink === ""
        ? []
        : [
              `• *Content:* <https://www.reddit.com${withoutTitle(permalink)}|${kind === "post" ? "View Post" : "View Comment"}>`,
          ];
}

function message(text: string, color: string, lines: readonly string[]): SlackMessage {
    return {
        text,
        attachments: [
            {
                color,
                text: lines.join("\n"),
                mrkdwn_in: ["text"],
                footer: "Mod Action Notifications - Reports",
                ts: Math.floor(Date.now() / MS_PER_SECOND),
            },
        ],
    };
}

/**
 * Report alerts as Slack messages for the alert channel. They name the configured reason, never the report's own
 * words, and quote nothing of the content.
 */
export function createSlackReportAlerts(send: SlackSender): ReportAlerts {
    return {
        urgent: async ({ reason, report }: Readonly<{ reason: string; report: ContentReport }>): Promise<void> => {
            const urgent = message(`🚨 Urgent report: ${escapeText(reason)}`, "#ff0000", [
                "🚨 *Urgent Report*",
                `• *Reason:* ${escapeText(reason)}`,
                ...contentLines(report),
                `• *Reports:* ${String(report.reportCount)}`,
            ]);
            await send(urgent);
        },
        pileUp: async (report: ContentReport): Promise<void> => {
            const count = String(report.reportCount);
            const pileUp = message(`📣 Reports piling up: ${count} reports`, "#ff8800", [
                "📣 *Reports Piling Up*",
                `• *Reports:* ${count}`,
                ...contentLines(report),
            ]);
            await send(pileUp);
        },
    };
}
