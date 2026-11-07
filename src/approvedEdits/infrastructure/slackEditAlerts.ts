import { escapeText, inChannel, withoutTitle } from "../../slack/index.js";
import type { SlackSender } from "../../slack/index.js";
import type { EditAlerts } from "../application/ports.js";
import { hoursBetween } from "../domain/approvedEdits.js";
import type { Approval, ContentUpdate } from "../domain/approvedEdits.js";

const MS_PER_SECOND = 1000;

function howLongBefore(approval: Approval, editAt: number): string {
    const hours = hoursBetween(approval, editAt);
    if (hours === 0) {
        return "less than an hour before the edit";
    }
    return `${String(hours)} ${hours === 1 ? "hour" : "hours"} before the edit`;
}

/** A link to the item without the post's title in it; none without a permalink. */
function contentLines({ kind, permalink }: ContentUpdate): readonly string[] {
    return permalink === ""
        ? []
        : [
              `• *Content:* <https://www.reddit.com${withoutTitle(permalink)}|${kind === "post" ? "View Post" : "View Comment"}>`,
          ];
}

/**
 * An edit after approval as a Slack message for the alert channel: who edited, who approved and how long before, and
 * a link without the post's title. Neither version of the text is quoted.
 */
export function createSlackEditAlerts(send: SlackSender, alertChannel: string): EditAlerts {
    return {
        edited: async ({
            update,
            approval,
            editAt,
        }: Readonly<{ update: ContentUpdate; approval: Approval; editAt: number }>): Promise<void> => {
            const author = escapeText(update.author);
            const alert = {
                text: `✏️ Edited after approval: u/${author}'s ${update.kind}`,
                attachments: [
                    {
                        color: "#ff8800",
                        text: [
                            "✏️ *Edited After Approval*",
                            `• *Author:* u/${author}`,
                            `• *Approved by:* u/${escapeText(approval.approver)}, ${howLongBefore(approval, editAt)}`,
                            ...contentLines(update),
                        ].join("\n"),
                        mrkdwn_in: ["text"],
                        footer: "Mod Action Notifications - Edits After Approval",
                        ts: Math.floor(editAt / MS_PER_SECOND),
                    },
                ],
            };
            await send(inChannel(alert, alertChannel));
        },
    };
}
