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
    readonly value: string;
    readonly short: boolean;
}

/**
 * What a message quotes from Reddit: the IDs of the posts and comments its text comes from (t3_ and t1_ IDs), and
 * the same message without that text or their titles, to send instead once any of them is deleted on Reddit.
 */
export type Quoting = Readonly<{ contentIds: readonly string[]; withoutQuotes: SlackMessage }>;

/**
 * Hands a message over for delivery to Slack, which may come later: alerts are queued and delivered at Slack's
 * pace. A message that quotes Reddit content says so, and loses the quotes if that content is deleted before it is
 * sent. Never rejects: what cannot be delivered is retried, then logged.
 */
export type SlackSender = (message: SlackMessage, quoting?: Quoting) => Promise<void>;

/** Sends a message to Slack now, for a moderator waiting on the result: true when Slack accepted it. Never rejects. */
export type DirectSlackSender = (message: SlackMessage) => Promise<boolean>;

/**
 * `text` as Slack shows it literally. Slack reads `&`, `<` and `>` as markup (`<!channel>` notifies everyone in the
 * channel, `<url|label>` is a link), so text the app did not write escapes them.
 */
export function escapeText(text: string): string {
    return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

/** `text` as a Slack block quote, every line of it: an unquoted line would read as part of the message. */
export function quote(text: string): string {
    return escapeText(text)
        .split("\n")
        .map((line: string): string => `> ${line}`)
        .join("\n");
}

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

/**
 * A Reddit permalink without the post's title in it: a post's `/r/sub/comments/abc/title/` becomes
 * `/r/sub/comments/abc/`, and a comment's `/r/sub/comments/abc/title/def/` becomes `/r/sub/comments/abc/_/def/`.
 * Reddit reads the link by its IDs, so it still opens the same post or comment. Other links are left as they are.
 */
export function withoutTitle(permalink: string): string {
    const match = /\/comments\/(?<post>[\da-z]+)\/[^#/?]+(?:\/(?<comment>[\da-z]+))?\/?$/iu.exec(permalink);
    const post = match?.groups?.["post"];
    if (match === null || post === undefined) {
        return permalink;
    }
    const comment = match.groups?.["comment"];
    return `${permalink.slice(0, match.index)}/comments/${post}/${comment === undefined ? "" : `_/${comment}/`}`;
}
