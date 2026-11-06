import { inChannel } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type { WeeklyDigest } from "../domain/digest.js";
import { countOf, reportLines } from "./reportLines.js";
import type { ActionNamer, ReportLine } from "./reportLines.js";

const MS_PER_SECOND = 1000;

function digestMessage({ from, to, report, weekBeforeTotal }: WeeklyDigest, nameOf: ActionNamer): SlackMessage {
    const lines: readonly ReportLine[] = [
        ...reportLines(report, nameOf),
        { label: "The week before", value: countOf(weekBeforeTotal, "action") },
    ];
    return {
        text: `📊 Team statistics, ${from} to ${to}: ${countOf(report.actions.total, "action")}`,
        username: "Mod Action Notifications",
        icon_emoji: ":bar_chart:",
        attachments: [
            {
                color: "#0088ff",
                fields: lines.map(({ label, value }: ReportLine): { title: string; value: string; short: boolean } => ({
                    title: label,
                    value,
                    short: false,
                })),
                footer: "Mod Action Notifications - Weekly Statistics",
                ts: Math.floor(Date.now() / MS_PER_SECOND),
            },
        ],
    };
}

/** The weekly digest as a Slack message, handed to `send`, which queues it, for `channel`. */
export function createSlackDigest(
    send: SlackSender,
    channel: string,
    nameOf: ActionNamer,
): (digest: WeeklyDigest) => Promise<void> {
    return async (digest: WeeklyDigest): Promise<void> => {
        await send(inChannel(digestMessage(digest, nameOf), channel));
    };
}
