import { PostCreate, PostDelete, PostUpdate } from '@devvit/protos/types/devvit/events/v1alpha/events.js';
import { ModAction } from '@devvit/protos/types/devvit/reddit/v2alpha/modaction.js';
import { SUBREDDIT } from './fakeContext';

/**
 * Trigger events shaped exactly as Devvit delivers them: the protobuf messages, completed with protobuf
 * defaults (empty strings, zeroes) for every field a test leaves out, plus the trigger's `type`.
 */

export function modActionEvent(fields: Parameters<typeof ModAction.fromPartial>[0]) {
  return { type: 'ModAction', ...ModAction.fromPartial({ subreddit: { name: SUBREDDIT }, ...fields }) };
}

export function postCreateEvent(fields: Parameters<typeof PostCreate.fromPartial>[0]) {
  return { type: 'PostCreate', ...PostCreate.fromPartial({ subreddit: { name: SUBREDDIT }, ...fields }) };
}

export function postUpdateEvent(fields: Parameters<typeof PostUpdate.fromPartial>[0]) {
  return { type: 'PostUpdate', ...PostUpdate.fromPartial({ subreddit: { name: SUBREDDIT }, ...fields }) };
}

export function postDeleteEvent(fields: Parameters<typeof PostDelete.fromPartial>[0]) {
  return { type: 'PostDelete', ...PostDelete.fromPartial({ subreddit: { name: SUBREDDIT }, ...fields }) };
}

/** EventSource values from @devvit/protos. */
export const EventSource = { USER: 1, ADMIN: 2, MODERATOR: 3 } as const;

/** DeletionReason values from @devvit/protos. */
export const DeletionReason = { SPAM: 1, OTHER: 3 } as const;
