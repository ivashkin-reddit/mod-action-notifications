import type { Form } from '@devvit/public-api';
import type { SimulationRequest } from '../application/simulateModAction';

/** The Simulate Mod Action form; simulationRequestFromForm reads what it submits. */
export const simulateForm: Form = {
  title: 'Simulate Mod Action',
  description: 'Send a simulated moderator action to Slack without touching live data.',
  fields: [
    {
      name: 'actionType',
      label: 'Action Type',
      type: 'select',
      options: [
        { label: 'Remove Post', value: 'removelink' },
        { label: 'Remove Comment', value: 'removecomment' },
        { label: 'Ban User', value: 'banuser' },
        { label: 'Unban User', value: 'unbanuser' },
        { label: 'Mute User', value: 'muteuser' },
        { label: 'Unmute User', value: 'unmuteuser' },
      ],
      defaultValue: ['removelink'],
    },
    {
      name: 'moderatorName',
      label: 'Moderator Name',
      type: 'string',
      helpText: 'Optional. Defaults to SimulationMod when left blank.',
    },
    {
      name: 'targetUser',
      label: 'Target Username',
      type: 'string',
      helpText: 'Optional username this action should apply to.',
    },
    {
      name: 'includeModNote',
      label: 'Include Mod Note?',
      type: 'boolean',
      defaultValue: false,
    },
    {
      name: 'modNote',
      label: 'Mod Note',
      type: 'string',
      helpText: 'Optional text that will be included when Include Mod Note is enabled.',
    },
    {
      name: 'banDuration',
      label: 'Ban Duration (days)',
      type: 'number',
      helpText: 'Only used for ban actions. Specify 0 for a permanent ban.',
    },
    {
      name: 'customDetails',
      label: 'Custom Details',
      type: 'string',
      helpText: 'Optional override for the automatic details field.',
    },
    {
      name: 'slackChannel',
      label: 'Slack Channel Override',
      type: 'string',
      helpText: 'Optional channel like #moderators. Uses default channel when blank.',
    },
  ],
  acceptLabel: 'Send Simulation',
  cancelLabel: 'Cancel',
};

/** What a moderator asked for in the simulate form; blank text fields are left out. */
export function simulationRequestFromForm(values: Record<string, unknown>): SimulationRequest {
  const text = (value: unknown): string | undefined =>
    typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;

  let actionType = 'removelink';
  if (typeof values.actionType === 'string') {
    actionType = values.actionType;
  } else if (Array.isArray(values.actionType) && values.actionType.length > 0) {
    actionType = String(values.actionType[0]);
  }

  return {
    actionType,
    moderatorName: text(values.moderatorName),
    targetUser: text(values.targetUser),
    includeModNote: Boolean(values.includeModNote),
    modNote: typeof values.modNote === 'string' ? values.modNote : undefined,
    banDuration: banDurationValue(values.banDuration),
    customDetails: text(values.customDetails),
    slackChannel: text(values.slackChannel),
  };
}

function banDurationValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
