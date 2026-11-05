import { expect } from "vitest";
import { NOW } from "./app.js";
import type { SlackField, SlackMessage, SlackRequest } from "./fakeSlack.js";

const MS_PER_SECOND = 1000;

/** NOW as a Slack timestamp. */
export const NOW_SECONDS = Math.floor(NOW.getTime() / MS_PER_SECOND);
/** A mod-action message's time line for an action at NOW. */
export const WHEN_NOW = "• *When:* 2026-11-04 12:00:00 UTC";
export const MINUTE = 60_000;

/** The one message sent; fails the test unless exactly one was. */
export function onlyMessage(messages: readonly SlackMessage[]): SlackMessage {
    expect(messages).toHaveLength(1);
    const [message] = messages;
    if (message === undefined) {
        throw new Error("no message was sent");
    }
    return message;
}

/** The one request made; fails the test unless exactly one was. */
export function onlyRequest(requests: readonly SlackRequest[]): SlackRequest {
    expect(requests).toHaveLength(1);
    const [request] = requests;
    if (request === undefined) {
        throw new Error("no request was made");
    }
    return request;
}

/** The lines of a message's attachment text; [""] for no message or no text. */
export function lines(message: SlackMessage | undefined): readonly string[] {
    return (message?.attachments?.[0]?.text ?? "").split("\n");
}

export function lastLine(message: SlackMessage | undefined): string | undefined {
    const all = lines(message);
    return all[all.length - 1];
}

/** The last field of a message's attachment. */
export function lastField(message: SlackMessage | undefined): SlackField | undefined {
    const fields = message?.attachments?.[0]?.fields ?? [];
    return fields[fields.length - 1];
}
