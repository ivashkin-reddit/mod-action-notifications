/**
 * Slack: the message format every alert is written in, and delivery through the Slack app's bot token.
 *
 * This interface is the format, for capabilities: they render their alerts as SlackMessages in their
 * infrastructure and hand them to the SlackSender the composition root gives them, which queues them. delivery.ts
 * is the composition root's: the outbox, the direct sender and the test message.
 */
export {
    escapeText,
    inChannel,
    quote,
    withoutTitle,
    type DirectSlackSender,
    type SlackMessage,
    type SlackSender,
} from "./message.js";
