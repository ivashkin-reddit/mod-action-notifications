import { banDurationFrom, type ModAction, type ModActionTarget } from '../domain/modAction';

/**
 * Translates a ModAction trigger event into a ModAction.
 *
 * Devvit delivers `{ action, actionedAt, subreddit, moderator, targetUser, targetPost, targetComment, id }`.
 * Older shapes are still read: the action nested in `modAction` or `modaction`, a time in `createdAt` and
 * similar fields, and ban lengths and notes in fields Devvit's event never had. Devvit's own `actionedAt` is
 * not read, so the action is timed by when the trigger runs.
 */
// The event arrives in several historical shapes, read defensively field by field.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function modActionFromTriggerEvent(event: any): ModAction {
  const source = event?.modAction ?? event?.modaction ?? event;
  const resolvedId = source?.id ?? event.id ?? event.modActionId ?? event.mod_action_id ?? null;
  const rawDetails = source?.details ?? event.details ?? undefined;
  const moderatorName: string | undefined = event.moderator?.name;

  const modAction: ModAction = {
    id: typeof resolvedId === 'string' ? resolvedId : resolvedId != null ? String(resolvedId) : undefined,
    type: event.action,
    moderatorName,
    subredditName: event.subreddit?.name,
    description: (source?.description ?? event.description ?? '') || '',
    details: rawDetails !== undefined && rawDetails !== null ? String(rawDetails) : rawDetails,
    occurredAt: occurredAt(source, event),
    target: target(source, event),
    isAutoModerator: (moderatorName ?? '').toLowerCase() === 'automoderator',
    relatedAction: null,
    activitySpike: null,
  };

  if (modAction.type === 'banuser') {
    const numericDuration =
      source?.duration ?? source?.banDuration ?? source?.ban_duration ??
      event.duration ?? event.banDuration ?? event.ban_duration ?? event.days ?? event.banDays ?? event.ban_days;
    Object.assign(modAction, banDurationFrom(numericDuration, modAction.details, modAction.description));
  }

  return modAction;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function occurredAt(source: any, event: any): Date {
  const time =
    source?.createdAt ??
    event.createdAt ??
    event.created_at ??
    event.triggeredAt ??
    event.triggered_at ??
    source?.timestamp ??
    event.timestamp ??
    null;

  if (!time) {
    return new Date();
  }
  if (time instanceof Date) {
    return time;
  }
  if (typeof time === 'string') {
    const parsed = new Date(time);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }
  if (typeof time === 'number') {
    // Seconds, unless it is too large to be.
    return new Date(time * (time > 10_000_000_000 ? 1 : 1000));
  }
  if (typeof time === 'object' && 'seconds' in time) {
    const seconds = Number(time.seconds ?? 0);
    const nanos = Number(time.nanos ?? 0);
    return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000));
  }
  return new Date();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function target(source: any, event: any): ModActionTarget | null {
  if (event.targetPost?.id) {
    return {
      author: event.targetUser?.name || event.targetPost?.authorId,
      permalink: event.targetPost?.permalink,
      body: event.targetPost?.selftext || event.targetPost?.title,
      isComment: false,
    };
  }
  if (event.targetComment?.id) {
    return {
      author: event.targetUser?.name || event.targetComment?.author,
      permalink: event.targetComment?.permalink,
      body: event.targetComment?.body,
      isComment: true,
    };
  }
  if (event.targetUser?.name) {
    return { author: event.targetUser.name, permalink: null, body: null, isComment: false };
  }
  if (source?.target) {
    return {
      author: source.target.author ?? undefined,
      permalink: source.target.permalink ?? null,
      body: source.target.body ?? source.target.title ?? null,
      isComment: Boolean(source.target.body && !source.target.title),
    };
  }
  return null;
}
