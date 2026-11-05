import { banLengthLabel, daysLabel } from "../domain/banDuration.js";
import { isAutoModeratorName, isBlank } from "../domain/modAction.js";
import type { ModAction } from "../domain/modAction.js";
import type { SimulationAlerts } from "./ports.js";

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
        isAutoModerator: isAutoModeratorName(moderatorName),
        relatedAction: undefined,
        activitySpike: undefined,
        ...banFields,
    };
}

/**
 * Sends the alert a mod action like the one requested would produce, in `subredditName`, without touching stored
 * data or checking the mod list. Rejects when the alert was not delivered.
 */
export async function simulateModAction(
    request: SimulationRequest,
    subredditName: string | undefined,
    alerts: SimulationAlerts,
): Promise<void> {
    if (!(await alerts.deliver(simulatedModAction(request, subredditName)))) {
        throw new Error("Slack did not accept the simulated alert");
    }
}
