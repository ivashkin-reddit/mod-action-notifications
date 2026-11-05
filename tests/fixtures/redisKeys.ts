import type { FakeRedis } from "./fakeRedis.js";

/**
 * The keys in Redis apart from the Slack outbox's own (`slack_outbox*`): a test of what a capability keeps leaves
 * the outbox's queue and its scheduling, which tests/integration/slackOutbox.test.ts and src/slack/ cover, to the outbox.
 */
export function keysBesidesOutbox(redis: Readonly<Pick<FakeRedis, "keys">>): readonly string[] {
    return redis.keys().filter((key: string): boolean => !key.startsWith("slack_outbox"));
}
