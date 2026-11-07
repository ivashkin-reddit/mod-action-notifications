import { escapeText, quote, withoutTitle } from "../../slack/index.js";
import type { DirectSlackSender, SlackDestinations, SlackMessage, SlackSender } from "../../slack/index.js";
import type { ModActionAlerts, SimulationAlerts } from "../application/ports.js";
import { isSecurityAction } from "../domain/alerting.js";
import { banDurationText } from "../domain/banDuration.js";
import type { BurstSummary } from "../domain/burst.js";
import { disciplineStep } from "../domain/discipline.js";
import type { HistoryCounts, RecentHistory } from "../domain/history.js";
import { isBlank } from "../domain/modAction.js";
import type { Actor, ModAction, ModActionTarget } from "../domain/modAction.js";
import { actionColor, actionName, actionTitle } from "./actionCatalog.js";
import { burstMessage } from "./slackBurstAlerts.js";
import { actorName, actorTitle, timestamp, userLink } from "./slackText.js";

export interface ModActionPresentation {
    readonly includeModNote: boolean;
    /** Send security actions as security alerts, to the alert channel. */
    readonly securityAlerts: boolean;
}

const PREVIEW_LENGTH = 200;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;

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

/** The counted kinds, in the order the line gives them, with their names for one and for several. */
const HISTORY_KINDS: readonly Readonly<{ kind: keyof HistoryCounts; one: string; many: string }>[] = [
    { kind: "removal", one: "removal", many: "removals" },
    { kind: "spam", one: "spam removal", many: "spam removals" },
    { kind: "ban", one: "ban", many: "bans" },
    { kind: "mute", one: "mute", many: "mutes" },
    { kind: "note", one: "note", many: "notes" },
];

/** For a ban: what the user's mod notes record in the days before it, as counts. */
function historyLines(history: RecentHistory | undefined): readonly string[] {
    if (history === undefined) {
        return [];
    }
    const counted = HISTORY_KINDS.filter(({ kind }): boolean => history.counts[kind] > 0).map(
        ({ kind, one, many }): string => `${String(history.counts[kind])} ${history.counts[kind] === 1 ? one : many}`,
    );
    const summary = counted.length === 0 ? "nothing in mod notes" : counted.join(", ");
    return [`• *Last ${String(history.days)} days:* ${summary}`];
}

/** For an unban or unmute: the ban or mute it lifts. */
function relatedLines(modAction: ModAction): readonly string[] {
    const related = modAction.relatedAction;
    if (related === undefined) {
        return [];
    }
    const pieces = [
        ...(isBlank(related.moderatorName)
            ? []
            : [`${actorTitle(related.moderatorName)} ${actorName(related.moderatorName)}`]),
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
    /** A status for the actor; '' for none. */
    status: string;
}>;

const ACTOR_STYLES: Readonly<Record<Actor, ActorStyle>> = {
    "moderator": {
        header: "🔔 *Moderator Action*",
        text: (title: string): string => title,
        status: "",
    },
    "unknown-moderator": {
        header: "🚨 *Security Alert*",
        text: (title: string): string => `🚨 SECURITY ALERT: ${title} by unknown moderator`,
        status: "Unknown moderator (alert)",
    },
    "reddit": {
        header: "🔶 *Reddit Action*",
        text: (title: string): string => `${title} by Reddit`,
        status: "Origin Reddit",
    },
};

/** A security action's alert, unless an unknown moderator took it: theirs is a security alert already. */
const SECURITY_STYLE: ActorStyle = {
    header: "🛡️ *Security Alert*",
    text: (title: string): string => `🛡️ Security alert: ${title}`,
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
        ...(spike === undefined || actor !== "moderator"
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
        `• *${actorTitle(modAction.moderatorName)}:* ${actorName(modAction.moderatorName)}`,
        ...targetLines(modAction.target),
        `• *When:* ${timestamp(modAction.occurredAt)}`,
        ...detailLines(modAction, presentation.includeModNote),
        ...historyLines(modAction.recentHistory),
        ...relatedLines(modAction),
        ...statusLines(modAction, actor),
    ];
}

function modActionMessage(modAction: ModAction, presentation: ModActionPresentation, actor: Actor): SlackMessage {
    const unknownModerator = actor === "unknown-moderator";
    const style = styleOf(modAction, actor, presentation);
    const message: SlackMessage = {
        text: style.text(actionTitle(modAction.type, modAction.target?.commentId !== undefined)),
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
    return message;
}

/** Whether the action's alert goes to the Alert Channel: an unknown moderator's action, or a security alert. */
function isUrgent(modAction: ModAction, presentation: ModActionPresentation, actor: Actor): boolean {
    return actor === "unknown-moderator" || isSecurityAlert(modAction, actor, presentation);
}

/** The Reddit content an action's alert quotes: the comment's or post's text, and the post's title in its link. */
function quotedContent(target: ModActionTarget | undefined): readonly string[] {
    return [target?.commentId, target?.postId].filter((id: string | undefined): id is string => id !== undefined);
}

/**
 * The action as its alert shows it once the content is deleted: without the content's text, or a title in its link.
 * Records keep this version, to replace the alert in Slack, and records hold no mod note, so it has none either.
 */
function withoutContent(modAction: ModAction): ModAction {
    const { target } = modAction;
    return target === undefined
        ? modAction
        : {
              ...modAction,
              description: undefined,
              target: {
                  ...target,
                  body: undefined,
                  permalink: target.permalink === undefined ? undefined : withoutTitle(target.permalink),
              },
          };
}

type Attachment = NonNullable<SlackMessage["attachments"]>[number];

/** The alert of the removal that opened a burst, saying the account's further removals will be summarised. */
function withBurstLine(message: SlackMessage, moderatorName: string | undefined): SlackMessage {
    const line = `• *Burst:* Further removals by ${actorName(moderatorName)} will be summarised`;
    return {
        ...message,
        attachments: (message.attachments ?? []).map((attachment: Attachment, index: number): Attachment =>
            index === 0
                ? {
                      ...attachment,
                      text: `${attachment.text ?? ""}
${line}`,
                  }
                : attachment,
        ),
    };
}

/**
 * Mod-action alerts as Slack messages, handed to the sender for where each goes, which queues it: an unknown
 * moderator's action or a security alert to `alerts`, the rest to `notifications`. An alert on a post or comment
 * says so, with its version without the content, to be sent instead if the content is deleted before the alert goes.
 */
export function createSlackModActionAlerts(
    destinations: SlackDestinations<SlackSender>,
    presentation: ModActionPresentation,
): ModActionAlerts {
    return {
        report: async (modAction: ModAction, actor: Actor, opensBurst: boolean): Promise<void> => {
            const send = isUrgent(modAction, presentation, actor) ? destinations.alerts : destinations.notifications;
            const told = (shown: ModAction): SlackMessage => {
                const message = modActionMessage(shown, presentation, actor);
                return opensBurst ? withBurstLine(message, modAction.moderatorName) : message;
            };
            const contentIds = quotedContent(modAction.target);
            await (contentIds.length === 0
                ? send(told(modAction))
                : send(told(modAction), { contentIds, withoutQuotes: told(withoutContent(modAction)) }));
        },
        reportBurst: async (summary: BurstSummary): Promise<void> => {
            await destinations.notifications(burstMessage(summary));
        },
    };
}

/** An alert marked as a simulation in its text and footer, so no one takes it for a moderator's real action. */
function asSimulation(message: SlackMessage): SlackMessage {
    return {
        ...message,
        text: `🧪 Simulation: ${message.text}`,
        attachments: (message.attachments ?? []).map((attachment: Attachment): Attachment => ({
            ...attachment,
            footer: "Mod Action Notifications - Simulation",
        })),
    };
}

/** A simulated action's alert as a moderator's Slack message, marked as a simulation, sent straight to Slack. */
export function createSlackSimulationAlerts(
    destinations: SlackDestinations<DirectSlackSender>,
    presentation: ModActionPresentation,
): SimulationAlerts {
    return {
        deliver: async (modAction: ModAction): Promise<boolean> => {
            const send = isUrgent(modAction, presentation, "moderator")
                ? destinations.alerts
                : destinations.notifications;
            return await send(asSimulation(modActionMessage(modAction, presentation, "moderator")));
        },
    };
}
