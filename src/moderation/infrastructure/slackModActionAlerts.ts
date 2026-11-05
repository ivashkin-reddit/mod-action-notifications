import { escapeText, inChannel, quote } from "../../slack/index.js";
import type { SlackMessage, SlackSender } from "../../slack/index.js";
import type { ModActionAlerts, ReportOptions } from "../application/ports.js";
import { ACTIVITY_SPIKE_ACTIONS } from "../domain/activity.js";
import { banDurationText } from "../domain/banDuration.js";
import { isBlank } from "../domain/modAction.js";
import type { Actor, ModAction, ModActionTarget } from "../domain/modAction.js";
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
    return `<https://www.reddit.com/u/${encodeURIComponent(normalized)}|u/${escapeText(normalized)}>`;
}

function timestamp(date: Date): string {
    return date.toISOString().replace("T", " ").replace(/\..+/u, " UTC");
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

/** A quote of at most 200 characters of the content, written by whoever posted it; none for blank content. */
function previewLine(body: string | undefined): readonly string[] {
    const text = body ?? "";
    const preview = text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}...` : text;
    return preview.trim() === "" ? [] : [quote(preview)];
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
        ...(isBlank(modAction.details) ? [] : [`• *Details:* ${escapeText(modAction.details)}`]),
        ...(includeModNote && !isBlank(modAction.description)
            ? [`• *Mod Note:* ${escapeText(modAction.description)}`]
            : []),
    ];
}

/** Ban length, then details and mod note. */
function detailLines(modAction: ModAction, includeModNote: boolean): readonly string[] {
    return [
        ...(modAction.type === "banuser" ? [`• *Ban Duration:* ${escapeText(banDurationText(modAction))}`] : []),
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
        ...(isBlank(detail) ? [] : [`Details ${escapeText(detail)}`]),
    ];
    const title = modAction.type === "unmuteuser" ? "Related Mute" : "Related Ban";
    return pieces.length === 0 ? [] : [`• *${title}:* ${pieces.join(" • ")}`];
}

/** How an alert presents who took the action. */
type ActorStyle = Readonly<{
    header: string;
    /** The message's text, given the action's title. */
    text: (title: string) => string;
    icon: string;
    /** A status for the actor; '' for none. */
    status: string;
}>;

const ACTOR_STYLES: Readonly<Record<Actor, ActorStyle>> = {
    "moderator": {
        header: "🔔 *Moderator Action*",
        text: (title: string): string => title,
        icon: ":shield:",
        status: "",
    },
    "unknown-moderator": {
        header: "🚨 *Security Alert*",
        text: (title: string): string => `🚨 SECURITY ALERT: ${title} by unknown moderator`,
        icon: ":warning:",
        status: "Unknown moderator (alert)",
    },
    "reddit": {
        header: "🔶 *Reddit Action*",
        text: (title: string): string => `${title} by Reddit`,
        icon: ":shield:",
        status: "Origin Reddit",
    },
};

function statusLines(modAction: ModAction, actor: Actor): readonly string[] {
    const spike = modAction.activitySpike;
    const { status: actorStatus } = ACTOR_STYLES[actor];
    const status = [
        ...(actorStatus === "" ? [] : [actorStatus]),
        ...(modAction.isAutoModerator ? ["Origin AutoModerator"] : []),
        ...(spike !== undefined && spike.count >= ACTIVITY_SPIKE_ACTIONS
            ? [
                  `Activity spike ${String(spike.count)} actions / ${String(Math.round(spike.windowSeconds / SECONDS_PER_MINUTE))} min`,
              ]
            : []),
    ];
    return status.length === 0 ? [] : [`• *Status:* ${status.join(" | ")}`];
}

function messageLines(modAction: ModAction, presentation: ModActionPresentation, actor: Actor): readonly string[] {
    const isComment = modAction.target?.isComment === true;
    return [
        ACTOR_STYLES[actor].header,
        `• *Action:* ${actionName(modAction.type, isComment)}`,
        `• *Moderator:* ${userLink(modAction.moderatorName)}`,
        ...targetLines(modAction.target),
        `• *When:* ${timestamp(modAction.occurredAt)}`,
        ...detailLines(modAction, presentation.includeModNote),
        ...relatedLines(modAction),
        ...statusLines(modAction, actor),
    ];
}

function modActionMessage(modAction: ModAction, presentation: ModActionPresentation, actor: Actor): SlackMessage {
    const unknownModerator = actor === "unknown-moderator";
    const style = ACTOR_STYLES[actor];
    const message: SlackMessage = {
        text: style.text(actionTitle(modAction.type, modAction.target?.isComment === true)),
        username: "Reddit Mod Bot",
        icon_emoji: style.icon,
        attachments: [
            {
                color: unknownModerator ? "#ff0000" : actionColor(modAction.type),
                text: messageLines(modAction, presentation, actor).join("\n"),
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
        report: async (modAction: ModAction, { actor, channel }: ReportOptions): Promise<boolean> =>
            await send(inChannel(modActionMessage(modAction, presentation, actor), channel)),
    };
}
