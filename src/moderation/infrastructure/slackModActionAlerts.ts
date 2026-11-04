import { inChannel } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type { ModActionAlerts, ReportOptions } from "../application/ports.js";
import { ACTIVITY_SPIKE_ACTIONS } from "../domain/activity.js";
import { banDurationText } from "../domain/banDuration.js";
import { isBlank } from "../domain/modAction.js";
import type { ModAction, ModActionTarget } from "../domain/modAction.js";
import { actionColor, actionName, actionTitle } from "./actionCatalog.js";

export interface ModActionPresentation {
    readonly includeModNote: boolean;
    /** Channel name without #, or '' for the webhook's own channel. */
    readonly notificationChannel: string;
    /** Channel name without # for security alerts, or '' to use the notification channel. */
    readonly alertChannel: string;
}

const PREVIEW_LENGTH = 200;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

/** A Slack link to the user's profile, without any u/ prefix; "Unknown" for a blank name. */
function userLink(username: string | undefined): string {
    const trimmed = username?.trim() ?? "";
    if (trimmed === "") {
        return "Unknown";
    }
    const normalized = trimmed.replace(/^u\//iu, "");
    return `<https://www.reddit.com/u/${encodeURIComponent(normalized)}|u/${normalized}>`;
}

function timestamp(date: Date): string {
    // An invalid Date (from a malformed event time) has no ISO form.
    return Number.isNaN(date.getTime())
        ? "Unknown time"
        : date.toISOString().replace("T", " ").replace(/\..+/u, " UTC");
}

function contentLine(target: ModActionTarget): readonly string[] {
    if (isBlank(target.permalink)) {
        return [];
    }
    const permalink = target.permalink.startsWith("http")
        ? target.permalink
        : `https://www.reddit.com${target.permalink}`;
    return [`• *Content:* <${permalink}|${target.isComment ? "View Comment" : "View Post"}>`];
}

/** A quote of at most 200 characters of the content; none for blank content. */
function previewLine(body: string | undefined): readonly string[] {
    const text = body ?? "";
    const preview = text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}...` : text;
    return preview.trim() === "" ? [] : [`> ${preview}`];
}

function targetLines(target: ModActionTarget | undefined): readonly string[] {
    if (target === undefined) {
        return [];
    }
    return [
        ...(isBlank(target.author) ? [] : [`• *Target:* ${userLink(target.author)}`]),
        ...contentLine(target),
        ...previewLine(target.body),
    ];
}

function noteLines(modAction: ModAction, includeModNote: boolean): readonly string[] {
    return [
        ...(isBlank(modAction.details) ? [] : [`• *Details:* ${modAction.details}`]),
        ...(includeModNote && !isBlank(modAction.description) ? [`• *Mod Note:* ${modAction.description}`] : []),
    ];
}

/** Ban length, then details and mod note. */
function detailLines(modAction: ModAction, includeModNote: boolean): readonly string[] {
    return [
        ...(modAction.type === "banuser" ? [`• *Ban Duration:* ${banDurationText(modAction)}`] : []),
        ...noteLines(modAction, includeModNote),
    ];
}

/** For an unban or unmute: the ban or mute it lifts. */
function relatedLines(modAction: ModAction): readonly string[] {
    const related = modAction.relatedAction;
    if (related === undefined || (modAction.type !== "unbanuser" && modAction.type !== "unmuteuser")) {
        return [];
    }
    const detail = isBlank(related.details) ? related.description : related.details;
    const pieces = [
        ...(isBlank(related.moderatorName) ? [] : [`Moderator ${userLink(related.moderatorName)}`]),
        ...(related.occurredAt === undefined ? [] : [`on ${related.occurredAt.toISOString()}`]),
        ...(isBlank(detail) ? [] : [`Details ${detail}`]),
    ];
    const title = modAction.type === "unmuteuser" ? "Related Mute" : "Related Ban";
    return pieces.length === 0 ? [] : [`• *${title}:* ${pieces.join(" • ")}`];
}

function statusLines(modAction: ModAction, unknownModerator: boolean): readonly string[] {
    const spike = modAction.activitySpike;
    const status = [
        ...(unknownModerator ? ["Unknown moderator (alert)"] : []),
        ...(modAction.isAutoModerator ? ["Origin AutoModerator"] : []),
        ...(spike !== undefined && spike.count >= ACTIVITY_SPIKE_ACTIONS
            ? [
                  `Activity spike ${String(spike.count)} actions / ${String(Math.round(spike.windowSeconds / SECONDS_PER_MINUTE))} min`,
              ]
            : []),
    ];
    return status.length === 0 ? [] : [`• *Status:* ${status.join(" | ")}`];
}

function messageLines(
    modAction: ModAction,
    presentation: ModActionPresentation,
    unknownModerator: boolean,
): readonly string[] {
    const isComment = modAction.target?.isComment === true;
    return [
        unknownModerator ? "🚨 *Security Alert*" : "🔔 *Moderator Action*",
        `• *Action:* ${actionName(modAction.type, isComment)}`,
        `• *Moderator:* ${userLink(modAction.moderatorName)}`,
        ...targetLines(modAction.target),
        `• *When:* ${timestamp(modAction.occurredAt)}`,
        ...detailLines(modAction, presentation.includeModNote),
        ...relatedLines(modAction),
        ...statusLines(modAction, unknownModerator),
    ];
}

function modActionMessage(
    modAction: ModAction,
    presentation: ModActionPresentation,
    unknownModerator: boolean,
): SlackMessage {
    const title = actionTitle(modAction.type, modAction.target?.isComment === true);
    const message: SlackMessage = {
        text: unknownModerator ? `🚨 SECURITY ALERT: ${title} by unknown moderator` : title,
        username: "Reddit Mod Bot",
        icon_emoji: unknownModerator ? ":warning:" : ":shield:",
        attachments: [
            {
                color: unknownModerator ? "#ff0000" : actionColor(modAction.type),
                text: messageLines(modAction, presentation, unknownModerator).join("\n"),
                mrkdwn_in: ["text", "fields"],
                footer: "Reddit Mod Action Bot",
                ts: Math.floor(modAction.occurredAt.getTime() / MS_PER_SECOND),
            },
        ],
    };
    const channel =
        unknownModerator && presentation.alertChannel !== ""
            ? presentation.alertChannel
            : presentation.notificationChannel;
    return inChannel(message, channel);
}

/** Mod-action alerts as Slack messages. */
export function createSlackModActionAlerts(send: SlackSender, presentation: ModActionPresentation): ModActionAlerts {
    return {
        report: async (modAction: ModAction, { unknownModerator, channel }: ReportOptions): Promise<void> => {
            await send(inChannel(modActionMessage(modAction, presentation, unknownModerator), channel));
        },
    };
}
