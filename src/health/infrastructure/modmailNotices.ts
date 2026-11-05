import type { TriggerContext } from "@devvit/public-api";
import type { ModeratorNotices } from "../application/ports.js";
import type { Notice } from "../domain/notices.js";

/** The modmail Devvit gives an app: the one call this adapter makes. */
export type NoticeReddit = Readonly<{
    modMail: Readonly<Pick<TriggerContext["reddit"]["modMail"], "createModNotification">>;
}>;

/** Whether the ID is a subreddit's, as Devvit names one: Devvit's context types it as any string. */
function isSubredditId(id: string): id is `t5_${string}` {
    return id.startsWith("t5_");
}

/**
 * Notices as modmail notifications to the subreddit: they appear in modmail's Notifications, sent by the app's
 * account, which Devvit gives full mod permissions. Rejects when modmail cannot take one.
 */
export function createModmailNotices(reddit: NoticeReddit, subredditId: string): ModeratorNotices {
    return {
        send: async ({ subject, body }: Notice): Promise<void> => {
            if (!isSubredditId(subredditId)) {
                throw new Error(`Not a subreddit ID: ${subredditId}`);
            }
            await reddit.modMail.createModNotification({ subject, bodyMarkdown: body, subredditId });
        },
    };
}
