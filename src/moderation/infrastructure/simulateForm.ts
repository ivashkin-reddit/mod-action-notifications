import type { Form } from "@devvit/public-api";
import type { SimulationRequest } from "../application/simulateModAction.js";
import { actionChoices } from "./actionCatalog.js";
import type { ActionChoice } from "./actionCatalog.js";

/** The Simulate Mod Action form; simulationRequestFromForm reads what it submits. */
export const simulateForm: Form = {
    title: "Simulate Mod Action",
    description: "Send a simulated moderator action to Slack without touching live data.",
    fields: [
        {
            name: "actionType",
            label: "Action Type",
            type: "select",
            options: actionChoices([
                "removelink",
                "removecomment",
                "banuser",
                "unbanuser",
                "muteuser",
                "unmuteuser",
            ]).map((choice: ActionChoice): { label: string; value: string } => ({ ...choice })),
            defaultValue: ["removelink"],
        },
        {
            name: "moderatorName",
            label: "Moderator Name",
            type: "string",
            helpText: "Optional. Defaults to SimulationMod when left blank.",
        },
        {
            name: "targetUser",
            label: "Target Username",
            type: "string",
            helpText: "Optional username this action should apply to.",
        },
        {
            name: "includeModNote",
            label: "Include Mod Note?",
            type: "boolean",
            defaultValue: false,
        },
        {
            name: "modNote",
            label: "Mod Note",
            type: "string",
            helpText: "Optional text that will be included when Include Mod Note is enabled.",
        },
        {
            name: "banDuration",
            label: "Ban Duration (days)",
            type: "number",
            helpText: "Only used for ban actions. Specify 0 for a permanent ban.",
        },
        {
            name: "customDetails",
            label: "Custom Details",
            type: "string",
            helpText: "Optional override for the automatic details field.",
        },
        {
            name: "slackChannel",
            label: "Slack Channel Override",
            type: "string",
            helpText: "Optional channel like #moderators. Uses default channel when blank.",
        },
    ],
    acceptLabel: "Send Simulation",
    cancelLabel: "Cancel",
};

/** What the simulate form submits: a select gives its chosen values, an unfilled field nothing. */
export type SimulateFormValues = Readonly<{
    actionType?: readonly string[] | undefined;
    moderatorName?: string | undefined;
    targetUser?: string | undefined;
    includeModNote?: boolean | undefined;
    modNote?: string | undefined;
    banDuration?: number | undefined;
    customDetails?: string | undefined;
    slackChannel?: string | undefined;
}>;

/** Trimmed text, or undefined when blank. */
function filled(value: string | undefined): string | undefined {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? undefined : trimmed;
}

/** What a moderator asked for in the simulate form. */
export function simulationRequestFromForm(values: SimulateFormValues): SimulationRequest {
    return {
        actionType: values.actionType?.[0] ?? "removelink",
        moderatorName: filled(values.moderatorName),
        targetUser: filled(values.targetUser),
        includeModNote: values.includeModNote ?? false,
        modNote: values.modNote,
        banDuration: values.banDuration,
        customDetails: filled(values.customDetails),
    };
}

/** The channel the simulate form asks the alert to go to, or '' for the configured one. */
export function slackChannelFromForm(values: SimulateFormValues): string {
    return filled(values.slackChannel) ?? "";
}
