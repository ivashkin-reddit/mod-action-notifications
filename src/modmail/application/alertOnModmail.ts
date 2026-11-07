import { isWaitingAlertOn, WAITING_ALERT_PERIOD_SECONDS, waitingModmail } from "../domain/modmail.js";
import type { ModmailMessage, OpenConversations, ReadMessage } from "../domain/modmail.js";
import type { ModmailAlerts, ModmailClaims, ModmailHealth, ModmailReader } from "./ports.js";

export interface ModmailPorts {
    readonly reader: ModmailReader;
    readonly claims: ModmailClaims;
    readonly alerts: ModmailAlerts;
    readonly health: ModmailHealth;
}

/** Claims an alert; one that cannot be stored still sends, as a second alert is better than none. */
async function claimed(claim: () => Promise<boolean>): Promise<boolean> {
    return await claim().catch((error: unknown): boolean => {
        console.warn("[modmail] Could not record that modmail was alerted, so it may be alerted again:", error);
        return true;
    });
}

/**
 * Reads modmail, reporting a failure as modmail being unreadable, and a success as its end. Undefined when the read
 * failed, as the health log has it.
 */
async function read<T>(reading: () => Promise<T>, health: ModmailHealth): Promise<T | undefined> {
    try {
        const result = await reading();
        await health.clear("modmail-unreadable");
        return result;
    } catch (error) {
        await health.raise("modmail-unreadable", error instanceof Error ? error.message : String(error));
        return undefined;
    }
}

/**
 * Alerts on a modmail message from a Reddit admin, once for each message. A moderator writing as one is not looked
 * up: only a user's message can be an admin's.
 */
export async function alertOnAdminModmail(message: ModmailMessage, ports: ModmailPorts): Promise<void> {
    if (message.byModerator || message.messageId === "") {
        return;
    }
    const found = await read(
        async (): Promise<ReadMessage | undefined> => await ports.reader.message(message),
        ports.health,
    );
    if (
        found?.byAdmin === true &&
        (await claimed(async (): Promise<boolean> => await ports.claims.claimAdminAlert(message.messageId)))
    ) {
        await ports.alerts.fromAdmin({
            conversationId: message.conversationId,
            author: message.authorName,
            subject: found.subject,
        });
    }
}

/**
 * Alerts, at most every six hours, when users have waited at least `waitHours` for a reply in modmail. Does nothing
 * while `waitHours` is 0.
 */
export async function checkWaitingModmail(waitHours: number, now: number, ports: ModmailPorts): Promise<void> {
    if (!isWaitingAlertOn(waitHours)) {
        return;
    }
    const open = await read(
        async (): Promise<OpenConversations> => await ports.reader.openConversations(),
        ports.health,
    );
    const waiting = open === undefined ? undefined : waitingModmail(open, waitHours, now);
    if (
        waiting !== undefined &&
        (await claimed(
            async (): Promise<boolean> => await ports.claims.claimWaitingAlert(WAITING_ALERT_PERIOD_SECONDS),
        ))
    ) {
        await ports.alerts.waiting(waiting);
    }
}
