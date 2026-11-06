import { escapeText, inChannel } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type { ModmailAlerts } from "../application/ports.js";
import type { WaitingModmail } from "../domain/modmail.js";

const MS_PER_SECOND = 1000;
const MODMAIL = "https://mod.reddit.com/mail";
const FOLDER_LINKS = `• *Modmail:* <${MODMAIL}/new|New> · <${MODMAIL}/inprogress|In Progress> · <${MODMAIL}/appeals|Appeals>`;

function message(text: string, style: Readonly<{ color: string }>, lines: readonly string[]): SlackMessage {
    return {
        text,
        attachments: [
            {
                color: style.color,
                text: lines.join("\n"),
                mrkdwn_in: ["text"],
                footer: "Mod Action Notifications - Modmail",
                ts: Math.floor(Date.now() / MS_PER_SECOND),
            },
        ],
    };
}

function plural(count: number, one: string, many: string): string {
    return count === 1 ? one : many;
}

/** "at least " when there may be more than the figure says. */
function atLeast({ complete }: WaitingModmail): string {
    return complete ? "" : "at least ";
}

function waitingLine(waiting: WaitingModmail): string {
    const appeals =
        waiting.appeals === 0
            ? ""
            : `, of them ${String(waiting.appeals)} ${plural(waiting.appeals, "ban appeal", "ban appeals")}`;
    return `• *Waiting for a reply:* ${atLeast(waiting)}${String(waiting.waiting)}${appeals}`;
}

/**
 * Modmail alerts as Slack messages for the alert channel. The admin alert gives the conversation's subject, which an
 * admin wrote, escaped; the waiting alert gives counts only.
 */
export function createSlackModmailAlerts(send: SlackSender, alertChannel: string): ModmailAlerts {
    return {
        fromAdmin: async ({
            conversationId,
            author,
            subject,
        }: Readonly<{ conversationId: string; author: string; subject: string }>): Promise<void> => {
            const name = escapeText(author);
            const alert = message(`🛡️ Modmail from a Reddit admin: u/${name}`, { color: "#ff4500" }, [
                "🛡️ *Modmail From a Reddit Admin*",
                `• *From:* u/${name}`,
                `• *Subject:* ${escapeText(subject)}`,
                `• *Conversation:* <${MODMAIL}/all/${encodeURIComponent(conversationId)}|Open in Modmail>`,
            ]);
            await send(inChannel(alert, alertChannel));
        },
        waiting: async (waiting: WaitingModmail): Promise<void> => {
            const conversations = plural(waiting.waiting, "conversation", "conversations");
            const hours = plural(waiting.longestHours, "hour", "hours");
            const alert = message(
                `📬 Modmail waiting for a reply: ${atLeast(waiting)}${String(waiting.waiting)} ${conversations}`,
                { color: "#ff8800" },
                [
                    "📬 *Modmail Waiting*",
                    waitingLine(waiting),
                    `• *Longest wait:* ${atLeast(waiting)}${String(waiting.longestHours)} ${hours} since the user last wrote`,
                    FOLDER_LINKS,
                ],
            );
            await send(inChannel(alert, alertChannel));
        },
    };
}
