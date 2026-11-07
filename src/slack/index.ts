/**
 * Slack: the message format every alert is written in, and delivery through the Slack app's bot token.
 *
 * This interface is the format, for capabilities: they render their alerts as SlackMessages in their
 * infrastructure and hand them to the SlackSenders the composition root gives them, each tied to a channel and the
 * queue it is delivered from, which queue them. delivery.ts
 * is the composition root's: the outbox, the direct sender and the test message.
 */
export {
    escapeText,
    quote,
    withoutTitle,
    type DirectSlackSender,
    type SlackDestinations,
    type SlackMessage,
    type SlackSender,
} from "./message.js";
