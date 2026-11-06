import { escapeText, inChannel } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type { ConfigEditedAlert, MisfireAlert, SecurityAlerts, WokeAlert } from "../application/ports.js";
import { CONFIG_PAGE } from "../domain/watch.js";

/** How an action type is named, e.g. "Post Removed": the moderation module knows; the composition root passes it in. */
export type ActionNamer = (type: string) => string;

const MS_PER_SECOND = 1000;

function userLink(username: string): string {
    return `<https://www.reddit.com/u/${encodeURIComponent(username)}|u/${escapeText(username)}>`;
}

function timestamp(at: number): string {
    return new Date(at).toISOString().replace("T", " ").replace(/\..+/u, " UTC");
}

/** A link to the config's revisions, which show who changed what; none without the subreddit's name. */
function historyLines(subredditName: string | undefined): readonly string[] {
    return subredditName === undefined || subredditName === ""
        ? []
        : [
              `• *History:* <https://www.reddit.com/r/${encodeURIComponent(subredditName)}/wiki/revisions/${CONFIG_PAGE}|View the config's revisions>`,
          ];
}

function countOf(count: number, noun: string): string {
    return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function averageLabel(average: number): string {
    return Number.isInteger(average) ? String(average) : average.toFixed(1);
}

function message(text: string, color: string, lines: readonly string[]): SlackMessage {
    return {
        text,
        username: "Mod Action Notifications",
        icon_emoji: ":shield:",
        attachments: [
            {
                color,
                text: lines.join("\n"),
                mrkdwn_in: ["text"],
                footer: "Mod Action Notifications - Security",
                ts: Math.floor(Date.now() / MS_PER_SECOND),
            },
        ],
    };
}

function wokeMessage({ moderator, days, lastAt, type }: WokeAlert, nameOf: ActionNamer): SlackMessage {
    return message(
        `🛡️ Security alert: u/${escapeText(moderator)} took their first action in ${String(days)} days`,
        "#ff8800",
        [
            "🛡️ *Security Alert*",
            `• *Moderator:* ${userLink(moderator)}`,
            `• *Last action before:* ${timestamp(lastAt)}`,
            `• *Action:* ${escapeText(nameOf(type))}`,
        ],
    );
}

function configEditedMessage({ moderator, reason, added, removed, subredditName }: ConfigEditedAlert): SlackMessage {
    return message(`🛡️ Security alert: AutoModerator's config was edited by u/${escapeText(moderator)}`, "#ff8800", [
        "🛡️ *Security Alert*",
        `• *Moderator:* ${userLink(moderator)}`,
        ...(reason.trim() === "" ? [] : [`• *Reason:* ${escapeText(reason)}`]),
        `• *Changes:* ${countOf(added, "line")} added, ${String(removed)} removed`,
        ...historyLines(subredditName),
    ]);
}

function misfireMessage({ editor, removals, hourlyAverage, subredditName }: MisfireAlert): SlackMessage {
    return message(
        `⚠️ AutoModerator removed ${String(removals)} items in the hour after u/${escapeText(editor)} edited its config`,
        "#ff0000",
        [
            "⚠️ *AutoModerator may be misfiring*",
            `• *Since the edit:* ${countOf(removals, "removal")}`,
            `• *The day before:* ${averageLabel(hourlyAverage)} an hour on average`,
            ...historyLines(subredditName),
        ],
    );
}

/** Security alerts as Slack messages, handed to `send`, which queues them, for the alert channel. */
export function createSlackSecurityAlerts(
    send: SlackSender,
    alertChannel: string,
    nameOf: ActionNamer,
): SecurityAlerts {
    return {
        moderatorWoke: async (alert: WokeAlert): Promise<void> => {
            await send(inChannel(wokeMessage(alert, nameOf), alertChannel));
        },
        configEdited: async (alert: ConfigEditedAlert): Promise<void> => {
            await send(inChannel(configEditedMessage(alert), alertChannel));
        },
        misfiring: async (alert: MisfireAlert): Promise<void> => {
            await send(inChannel(misfireMessage(alert), alertChannel));
        },
    };
}
