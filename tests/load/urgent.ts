import { modActionEvent } from "../fixtures/events.js";
import type { EventKind, EventStream, GeneratedEvent } from "./events.js";
import type { Harness, Post } from "./harness.js";

/**
 * Alerts for the Alert Channel fired during a scenario, and how long each waits for Slack: what the alert queue,
 * delivered before notifications, is for.
 */

/** A moderator changing another's permissions: a security alert, which goes to the Alert Channel. */
function permissionChange(index: number): ReturnType<typeof modActionEvent> {
    return modActionEvent({
        id: `ModAction_urgent_${String(index)}`,
        action: "setpermissions",
        moderator: { name: "ModA" },
        targetUser: { name: `Urgent${String(index)}` },
    });
}

async function sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve: () => void): void => {
        setTimeout(resolve, ms);
    });
}

/** Fires a security alert at each of `times` (ms from now); returns when each was fired, in ms since the epoch. */
export async function fireSecurityAlerts(
    deliver: Harness["deliver"],
    times: readonly number[],
): Promise<readonly number[]> {
    const started = Date.now();
    const fired: number[] = [];
    for (const [index, after] of times.entries()) {
        await sleep(Math.max(0, started + after - Date.now()));
        fired.push(Date.now());
        await deliver("ModAction", permissionChange(index));
    }
    return fired;
}

/** How long each alert fired at `fired` waited until Slack took it, in ms; null for one Slack never took. */
export function waitsOf(posts: readonly Post[], fired: readonly number[]): readonly (number | null)[] {
    return fired.map((at: number, index: number): number | null => {
        const post = posts.find(({ body }: Post): boolean => body.includes(`Urgent${String(index)}`));
        return post === undefined ? null : post.at - at;
    });
}

/**
 * One moderator removing comments, as in clearing a brigaded thread: each of the stream's mod actions, taken by ModA
 * as a comment removal.
 */
export function oneModeratorRemoving(stream: EventStream): EventStream {
    return {
        next: (kind?: EventKind): GeneratedEvent => {
            const generated = stream.next(kind);
            const event: unknown = generated.event;
            return typeof event === "object" && event !== null
                ? { ...generated, event: { ...event, action: "removecomment", moderator: { name: "ModA" } } }
                : generated;
        },
        comments: (): number => stream.comments(),
    };
}
