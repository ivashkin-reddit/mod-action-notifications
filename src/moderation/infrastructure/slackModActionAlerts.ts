import { escapeText, inChannel, quote, withoutTitle } from "../../slack/index.js";
import type { DirectSlackSender, SlackMessage, SlackSender } from "../../slack/index.js";
import type { ModActionAlerts, SimulationAlerts } from "../application/ports.js";
import { isSecurityAction } from "../domain/alerting.js";
import { banDurationText } from "../domain/banDuration.js";
import { disciplineStep } from "../domain/discipline.js";
import { isBlank } from "../domain/modAction.js";
import type { Actor, ModAction, ModActionTarget } from "../domain/modAction.js";
import { actionColor, actionName, actionTitle } from "./actionCatalog.js";

export interface ModActionPresentation {
    readonly includeModNote: boolean;
    /** A channel ID, or a channel name without #. */
    readonly notificationChannel: string;
    /** A channel ID, or a channel name without #, for security alerts. */
    readonly alertChannel: string;
    /** Send security actions as security alerts, to the alert channel. */
    readonly securityAlerts: boolean;
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
    return [`• *Content:* <${permalink}|${target.commentId === undefined ? "View Post" : "View Comment"}>`];
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
    if (related === undefined) {
        return [];
    }
    const pieces = [
        ...(isBlank(related.moderatorName) ? [] : [`Moderator ${userLink(related.moderatorName)}`]),
        ...(related.occurredAt === undefined ? [] : [`on ${related.occurredAt.toISOString()}`]),
        // Its details, never its note: the note is shown, where the setting allows it, in the ban's own alert.
        ...(isBlank(related.details) ? [] : [`Details ${escapeText(related.details)}`]),
    ];
    const title = disciplineStep(modAction.type)?.kind === "mute" ? "Related Mute" : "Related Ban";
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

/** A security action's alert, unless an unknown moderator took it: theirs is a security alert already. */
const SECURITY_STYLE: ActorStyle = {
    header: "🛡️ *Security Alert*",
    text: (title: string): string => `🛡️ Security alert: ${title}`,
    icon: ":shield:",
    status: "",
};

/** A security action while Security Alerts is on, unless an unknown moderator took it: that alert is one already. */
function isSecurityAlert(modAction: ModAction, actor: Actor, presentation: ModActionPresentation): boolean {
    return presentation.securityAlerts && actor !== "unknown-moderator" && isSecurityAction(modAction);
}

function styleOf(modAction: ModAction, actor: Actor, presentation: ModActionPresentation): ActorStyle {
    return isSecurityAlert(modAction, actor, presentation) ? SECURITY_STYLE : ACTOR_STYLES[actor];
}

function statusLines(modAction: ModAction, actor: Actor): readonly string[] {
    const spike = modAction.activitySpike;
    const { status: actorStatus } = ACTOR_STYLES[actor];
    const status = [
        ...(actorStatus === "" ? [] : [actorStatus]),
        ...(modAction.isAutoModerator ? ["Origin AutoModerator"] : []),
        ...(spike === undefined
            ? []
            : [
                  `Activity spike ${String(spike.count)} actions / ${String(Math.round(spike.windowSeconds / SECONDS_PER_MINUTE))} min`,
              ]),
    ];
    return status.length === 0 ? [] : [`• *Status:* ${status.join(" | ")}`];
}

function messageLines(modAction: ModAction, presentation: ModActionPresentation, actor: Actor): readonly string[] {
    const isComment = modAction.target?.commentId !== undefined;
    return [
        styleOf(modAction, actor, presentation).header,
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
    const style = styleOf(modAction, actor, presentation);
    const message: SlackMessage = {
        text: style.text(actionTitle(modAction.type, modAction.target?.commentId !== undefined)),
        username: "Mod Action Notifications",
        icon_emoji: style.icon,
        attachments: [
            {
                color: unknownModerator ? "#ff0000" : actionColor(modAction.type),
                text: messageLines(modAction, presentation, actor).join("\n"),
                mrkdwn_in: ["text", "fields"],
                footer: "Mod Action Notifications",
                ts: Math.floor(modAction.occurredAt.getTime() / MS_PER_SECOND),
            },
        ],
    };
    const toAlertChannel = unknownModerator || isSecurityAlert(modAction, actor, presentation);
    return inChannel(message, toAlertChannel ? presentation.alertChannel : presentation.notificationChannel);
}

/** The Reddit content an action's alert quotes: the comment's or post's text, and the post's title in its link. */
function quotedContent(target: ModActionTarget | undefined): readonly string[] {
    return [target?.commentId, target?.postId].filter((id: string | undefined): id is string => id !== undefined);
}

/** The action as its alert shows it once the content is deleted: without the content's text, or a title in its link. */
function withoutContent(modAction: ModAction): ModAction {
    const { target } = modAction;
    return target === undefined
        ? modAction
        : {
              ...modAction,
              target: {
                  ...target,
                  body: undefined,
                  permalink: target.permalink === undefined ? undefined : withoutTitle(target.permalink),
              },
          };
}

/**
 * Mod-action alerts as Slack messages, handed to `send`, which queues them. An alert on a post or comment says so,
 * with its version without the content, to be sent instead if the content is deleted before the alert goes.
 */
export function createSlackModActionAlerts(send: SlackSender, presentation: ModActionPresentation): ModActionAlerts {
    return {
        report: async (modAction: ModAction, actor: Actor): Promise<void> => {
            const message = modActionMessage(modAction, presentation, actor);
            const contentIds = quotedContent(modAction.target);
            await (contentIds.length === 0
                ? send(message)
                : send(message, {
                      contentIds,
                      withoutQuotes: modActionMessage(withoutContent(modAction), presentation, actor),
                  }));
        },
    };
}

/** A simulated action's alert as a moderator's Slack message, sent straight to Slack. */
export function createSlackSimulationAlerts(
    send: DirectSlackSender,
    presentation: ModActionPresentation,
): SimulationAlerts {
    return {
        deliver: async (modAction: ModAction): Promise<boolean> =>
            await send(modActionMessage(modAction, presentation, "moderator")),
    };
}
