import type { FakeRedis } from "./fakeRedis.js";

/**
 * The keys in Redis apart from the app's bookkeeping: the Slack outbox's own (`slack_outbox*`), the health records
 * (`health:*`), the team statistics (`stats:*`) and the security watch's (`security:*`). A test of what a capability
 * keeps leaves the outbox's queue and scheduling, which tests/integration/slackOutbox.test.ts and src/slack/ cover,
 * the health records, which healthLog.test.ts and botStatus.test.ts cover, the statistics, which
 * teamStatistics.test.ts covers, and the security watch's, which dormantModerator.test.ts and the automod*.test.ts
 * files cover, to their own tests.
 */
export function keysBesidesBookkeeping(redis: Readonly<Pick<FakeRedis, "keys">>): readonly string[] {
    return redis
        .keys()
        .filter(
            (key: string): boolean =>
                !key.startsWith("slack_outbox") &&
                !key.startsWith("health:") &&
                !key.startsWith("stats:") &&
                !key.startsWith("security:"),
        );
}
