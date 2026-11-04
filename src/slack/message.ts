/** A Slack incoming-webhook payload, as the app sends it. */
export interface SlackMessage {
  text: string;
  username?: string;
  icon_emoji?: string;
  channel?: string;
  attachments?: SlackAttachment[];
}

export interface SlackAttachment {
  color: string;
  text?: string;
  fields?: SlackField[];
  footer?: string;
  ts?: number;
  mrkdwn_in?: string[];
}

export interface SlackField {
  title: string;
  /** Slack displays text. A number is sent as it is (the deleted-post alert's reason). */
  value: string | number;
  short: boolean;
}

/** Delivers a message to Slack. Never rejects: delivery failures are retried, then logged. */
export type SlackSender = (message: SlackMessage) => Promise<void>;

/** The `#channel` for a channel name given with or without its #, or undefined for the webhook's own channel. */
export function slackChannel(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return name.startsWith('#') ? name : `#${name}`;
}
