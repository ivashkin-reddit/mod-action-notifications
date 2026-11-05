import type { FakeRedis } from "./fakeRedis.js";

/**
 * The keys in Redis apart from the app's bookkeeping: the Slack outbox's own (`slack_outbox*`) and the health
 * records (`health:*`). A test of what a capability keeps leaves the outbox's queue and scheduling, which
 * tests/integration/slackOutbox.test.ts and src/slack/ cover, and the health records, which healthLog.test.ts and
 * botStatus.test.ts cover, to their own tests.
 */
export function keysBesidesBookkeeping(redis: Readonly<Pick<FakeRedis, "keys">>): readonly string[] {
    return redis.keys().filter((key: string): boolean => !key.startsWith("slack_outbox") && !key.startsWith("health:"));
}
