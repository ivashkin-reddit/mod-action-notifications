/** A Slack incoming-webhook payload, as the app sends it. */
export interface SlackMessage {
    readonly text: string;
    readonly username?: string;
    readonly icon_emoji?: string;
    readonly channel?: string;
    readonly attachments?: readonly SlackAttachment[];
}

export interface SlackAttachment {
    readonly color: string;
    readonly text?: string;
    readonly fields?: readonly SlackField[];
    readonly footer?: string;
    readonly ts?: number;
    readonly mrkdwn_in?: readonly string[];
}

export interface SlackField {
    readonly title: string;
    /** Slack displays text. A number is sent as it is (the deleted-post alert's reason). */
    readonly value: string | number;
    readonly short: boolean;
}

/** Delivers a message to Slack. Never rejects: delivery failures are retried, then logged. */
export type SlackSender = (message: SlackMessage) => Promise<void>;

/**
 * The message, sent to the named channel: `name` with or without its leading #. For '' the message is unchanged,
 * so it goes to the webhook's own channel.
 */
export function inChannel(message: SlackMessage, name: string): SlackMessage {
    if (name === "") {
        return message;
    }
    return { ...message, channel: name.startsWith("#") ? name : `#${name}` };
}
