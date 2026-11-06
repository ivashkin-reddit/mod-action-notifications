import type { Harness } from "./harness.js";

/**
 * The domain invariants, checked in Redis and in the fakes' records after a scenario: what latency alone cannot show.
 * Each check names what it found; a scenario passes when every one holds.
 */

export type Check = Readonly<{ name: string; holds: boolean; found: string }>;

async function count(harness: Harness, args: readonly string[]): Promise<number> {
    return Number(await harness.client.sendCommand([...args]));
}

async function exists(harness: Harness, key: string): Promise<boolean> {
    return (await count(harness, ["EXISTS", key])) > 0;
}

/** The bounds the app keeps its structures to (OPERATORS-GUIDE.md, "Data stored"). */
const BOUNDS: readonly (readonly [string, readonly string[], number])[] = [
    ["queued alerts", ["ZCARD", "slack_outbox"], 500],
    ["redactions waiting", ["ZCARD", "slack_outbox_redactions"], 5000],
    ["sent-alert entries", ["ZCARD", "slack_outbox_sent_by_time"], 100_000],
    ["items awaiting a moderator", ["HLEN", "stats:awaiting"], 10_000],
    ["modmail conversations awaiting a reply", ["HLEN", "stats:modmail_waiting"], 10_000],
];

/** Each alert's Slack message, taken once: no two posted messages are the same alert. */
function duplicatesIn(harness: Harness): number {
    const posted = harness.slack.requests
        .filter(({ api }): boolean => api === "chat.postMessage")
        .map(({ body }): string => JSON.stringify(body));
    return posted.length - new Set(posted).size;
}

export async function checkInvariants(
    harness: Harness,
    expectations: Readonly<{ alerts?: number }> = {},
): Promise<readonly Check[]> {
    const checks: Check[] = [];
    for (const [name, args, bound] of BOUNDS) {
        const size = await count(harness, args);
        checks.push({ name: `${name} within ${String(bound)}`, holds: size <= bound, found: String(size) });
    }
    const queued = await count(harness, ["ZCARD", "slack_outbox"]);
    checks.push({ name: "the outbox drained", holds: queued === 0, found: `${String(queued)} queued` });
    const leased = await exists(harness, "slack_outbox_lease");
    checks.push({ name: "no lease left held", holds: !leased, found: leased ? "held" : "free" });
    const duplicates = duplicatesIn(harness);
    checks.push({ name: "no alert posted twice", holds: duplicates === 0, found: `${String(duplicates)} repeated` });
    if (expectations.alerts !== undefined) {
        const posted = new Set(
            harness.slack.requests
                .filter(({ api }): boolean => api === "chat.postMessage")
                .map(({ body }): string => JSON.stringify(body)),
        ).size;
        checks.push({
            name: `${String(expectations.alerts)} alerts, as when each event came once`,
            holds: posted === expectations.alerts,
            found: `${String(posted)} posted`,
        });
    }
    return checks;
}
