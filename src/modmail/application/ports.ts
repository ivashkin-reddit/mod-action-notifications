import type { ModmailMessage, OpenConversations, ReadMessage, WaitingModmail } from "../domain/modmail.js";

/** The subreddit's modmail, as the app reads it. Each method rejects when modmail cannot be read. */
export interface ModmailReader {
    /** The message's conversation's subject and whether its author is an admin; undefined when Reddit finds neither. */
    readonly message: (message: ModmailMessage) => Promise<ReadMessage | undefined>;
    /** The conversations in the New, In Progress and Appeals folders. */
    readonly openConversations: () => Promise<OpenConversations>;
}

/** Which modmail alerts were sent. Each method rejects when storage fails. */
export interface ModmailClaims {
    /** Claims the admin alert for the message: true the first time in a day. */
    readonly claimAdminAlert: (messageId: string) => Promise<boolean>;
    /** Claims the waiting alert for the period: false when one was sent within it. */
    readonly claimWaitingAlert: (periodSeconds: number) => Promise<boolean>;
}

/** Modmail alerts, sent to the alert channel. Delivery may come later; neither rejects. */
export interface ModmailAlerts {
    readonly fromAdmin: (alert: Readonly<{ conversationId: string; author: string; subject: string }>) => Promise<void>;
    readonly waiting: (waiting: WaitingModmail) => Promise<void>;
}

/**
 * Where modmail that cannot be read is reported: a condition the health log reports once rather than on every
 * message or run. Neither function rejects.
 */
export interface ModmailHealth {
    /** Modmail cannot be read; `detail` says why the last read failed. */
    readonly raise: (condition: "modmail-unreadable", detail: string) => Promise<void>;
    readonly clear: (condition: "modmail-unreadable") => Promise<void>;
}
