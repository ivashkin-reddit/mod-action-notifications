/** How each mod action type is named and coloured in Slack. */
interface ActionStyle {
  emoji: string;
  name: string;
  /** The name when the action targets a comment, where it differs. */
  commentName?: string;
  color: string;
}

const ACTION_STYLES = new Map<string, ActionStyle>([
  ['removelink', { emoji: '🗑️', name: 'Post Removed', color: '#ff4444' }],
  ['removecomment', { emoji: '🗑️', name: 'Comment Removed', color: '#ff4444' }],
  ['spamlink', { emoji: '🚫', name: 'Post Marked as Spam', color: '#ff0088' }],
  ['spamcomment', { emoji: '🚫', name: 'Comment Marked as Spam', color: '#ff0088' }],
  ['banuser', { emoji: '🔨', name: 'User Banned', color: '#cc0000' }],
  ['unbanuser', { emoji: '🎉', name: 'User Unbanned', color: '#00cc00' }],
  ['lock', { emoji: '🔒', name: 'Post Locked', commentName: 'Comment Locked', color: '#ff8800' }],
  ['unlock', { emoji: '🔓', name: 'Post Unlocked', commentName: 'Comment Unlocked', color: '#00cc00' }],
  ['sticky', { emoji: '📌', name: 'Post Stickied', color: '#0088ff' }],
  ['unsticky', { emoji: '📌', name: 'Post Unstickied', color: '#888888' }],
  ['approvelink', { emoji: '✅', name: 'Post Approved', color: '#00cc00' }],
  ['approvecomment', { emoji: '✅', name: 'Comment Approved', color: '#00cc00' }],
  ['editflair', { emoji: '🏷️', name: 'Flair Edited', color: '#8800ff' }],
  ['muteuser', { emoji: '🔇', name: 'User Muted', color: '#ff8800' }],
  ['unmuteuser', { emoji: '🔊', name: 'User Unmuted', color: '#00cc00' }],
  ['distinguish', { emoji: '⭐', name: 'Distinguished', color: '#0088ff' }],
  ['ignorereports', { emoji: '🔕', name: 'Reports Ignored', color: '#888888' }],
  ['unignorereports', { emoji: '🔔', name: 'Reports Unignored', color: '#00cc00' }],
  ['snoozereports', { emoji: '⏰', name: 'Reports Snoozed', color: '#ff8800' }],
  ['unsnoozereports', { emoji: '⏰', name: 'Reports Unsnoozed', color: '#00cc00' }],
  ['addcontributor', { emoji: '✅', name: 'Approved User Added', color: '#00cc00' }],
  ['removecontributor', { emoji: '❌', name: 'Approved User Removed', color: '#ff4444' }],
  ['invitemoderator', { emoji: '📨', name: 'Moderator Invited', color: '#0088ff' }],
  ['uninvitemoderator', { emoji: '📭', name: 'Moderator Uninvited', color: '#ff8800' }],
  ['acceptmoderatorinvite', { emoji: '✅', name: 'Moderator Invite Accepted', color: '#00cc00' }],
  ['addmoderator', { emoji: '👤', name: 'Moderator Added', color: '#0088ff' }],
  ['removemoderator', { emoji: '👤', name: 'Moderator Removed', color: '#ff4444' }],
  ['editsettings', { emoji: '⚙️', name: 'Settings Edited', color: '#8800ff' }],
  ['adjust_post_crowd_control_level', { emoji: '👥', name: 'Crowd Control Adjusted', color: '#ff8800' }],
  ['enable_post_crowd_control_filter', { emoji: '🛡️', name: 'Crowd Control Enabled', color: '#ff8800' }],
  ['disable_post_crowd_control_filter', { emoji: '🛡️', name: 'Crowd Control Disabled', color: '#00cc00' }],
]);

const UNKNOWN_ACTION_COLOR = '#666666';

/** The action's name, e.g. "Post Removed"; an unknown type is named by itself. */
export function actionName(type: string, isComment: boolean): string {
  const style = ACTION_STYLES.get(type);
  if (!style) return type;
  return isComment && style.commentName ? style.commentName : style.name;
}

/** The action's name with its emoji, e.g. "🗑️ Post Removed"; an unknown type is named by itself. */
export function actionTitle(type: string, isComment: boolean): string {
  const style = ACTION_STYLES.get(type);
  return style ? `${style.emoji} ${actionName(type, isComment)}` : type;
}

export function actionColor(type: string): string {
  return ACTION_STYLES.get(type)?.color ?? UNKNOWN_ACTION_COLOR;
}
