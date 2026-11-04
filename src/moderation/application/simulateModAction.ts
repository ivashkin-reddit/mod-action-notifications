import { banLengthLabel, daysLabel } from "../domain/banDuration.js";
import { isBlank } from "../domain/modAction.js";
import type { ModAction } from "../domain/modAction.js";
import type { ModActionAlerts } from "./ports.js";

/** A moderator's request to see how an action would be reported. */
export interface SimulationRequest {
    readonly actionType: string;
    readonly moderatorName: string | undefined;
    readonly targetUser: string | undefined;
    readonly includeModNote: boolean;
    readonly modNote: string | undefined;
    /** For a ban: days, 0 for permanent. */
    readonly banDuration: number | undefined;
    readonly customDetails: string | undefined;
    /** '' for the configured channel. */
    readonly slackChannel: string;
}

export interface SimulationContext {
    /** Whether alerts have somewhere to go. */
    readonly alertsConfigured: boolean;
    readonly subredditName: string | undefined;
}

type BanFields = Pick<ModAction, "banDuration" | "banDurationLabel" | "details">;

/** How a simulated ban of this many days reads in its details. */
function banDetails(days: number): string {
    return days === 0 ? "permanent" : daysLabel(days);
}

/** A simulated ban's length (0, permanent, when none is given), and details describing it unless given. */
function simulatedBan(request: SimulationRequest): BanFields {
    const duration = request.banDuration ?? 0;
    if (!Number.isFinite(duration) || duration < 0) {
        return { banDuration: undefined, banDurationLabel: undefined, details: request.customDetails };
    }
    return {
        banDuration: duration,
        banDurationLabel: banLengthLabel(duration),
        details: isBlank(request.customDetails) ? banDetails(duration) : request.customDetails,
    };
}

function simulatedModAction(request: SimulationRequest, subredditName: string | undefined): ModAction {
    const moderatorName = request.moderatorName ?? "SimulationMod";
    const banFields: BanFields =
        request.actionType === "banuser"
            ? simulatedBan(request)
            : { banDuration: undefined, banDurationLabel: undefined, details: request.customDetails };
    return {
        id: undefined,
        type: request.actionType,
        moderatorName,
        subredditName: subredditName ?? "unknown",
        target:
            request.targetUser === undefined
                ? undefined
                : { author: request.targetUser, permalink: undefined, body: undefined, isComment: false },
        description: request.includeModNote ? (request.modNote ?? "Simulation note") : undefined,
        occurredAt: new Date(),
        isAutoModerator: moderatorName.toLowerCase() === "automoderator",
        relatedAction: undefined,
        activitySpike: undefined,
        ...banFields,
    };
}

/**
 * Sends the alert a mod action like the one requested would produce, without touching stored data or checking the
 * mod list. Rejects when alerts have nowhere to go.
 */
export async function simulateModAction(
    request: SimulationRequest,
    context: SimulationContext,
    alerts: ModActionAlerts,
): Promise<void> {
    if (!context.alertsConfigured) {
        throw new Error("Slack webhook URL is not configured");
    }
    await alerts.report(simulatedModAction(request, context.subredditName), {
        unknownModerator: false,
        channel: request.slackChannel,
    });
}
