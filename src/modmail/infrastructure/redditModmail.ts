import type { TriggerContext } from "@devvit/public-api";
import type { ModmailReader } from "../application/ports.js";
import { CONVERSATIONS_READ, withoutPrefix } from "../domain/modmail.js";
import type { ModmailMessage, OpenConversation, OpenConversations, ReadMessage } from "../domain/modmail.js";

export type ModmailReddit = Readonly<
    Pick<TriggerContext["reddit"], "getCurrentSubredditName"> & {
        modMail: Readonly<Pick<TriggerContext["reddit"]["modMail"], "getConversation" | "getConversations">>;
    }
>;

/** A participant in a conversation as Devvit gives one: what this adapter reads. */
type Author = Readonly<{ name?: string | undefined; isAdmin?: boolean | undefined }> | undefined;

/** A conversation as Devvit gives one: what this adapter reads. */
type Conversation = Readonly<{
    id?: string | undefined;
    subject?: string | undefined;
    isAuto?: boolean | undefined;
    lastUserUpdate?: string | undefined;
    lastModUpdate?: string | undefined;
    /** Devvit's conversation state, e.g. "New" or "Archived". */
    state?: string | undefined;
    authors: readonly Author[];
    messages: Readonly<Record<string, Readonly<{ id?: string | undefined; author?: Author }>>>;
}>;

/** The folders a user waits for a reply in, and whether a conversation in each is a ban appeal. */
const OPEN_FOLDERS = [
    ["new", false],
    ["inprogress", false],
    ["appeals", true],
] as const;

/** An ISO time as ms since the epoch; undefined for none, or one that does not parse. */
function msOf(time: string | undefined): number | undefined {
    const ms = time === undefined ? Number.NaN : Date.parse(time);
    return Number.isNaN(ms) ? undefined : ms;
}

/** The message's author: from the message itself, else the conversation's author of that name. */
function authorOf(conversation: Conversation, message: ModmailMessage): Author {
    const listed =
        conversation.messages[message.messageId] ??
        Object.values(conversation.messages).find(
            ({ id }: Readonly<{ id?: string | undefined }>): boolean => withoutPrefix(id ?? "") === message.messageId,
        );
    return (
        listed?.author ??
        conversation.authors.find(
            (author: Author): boolean => author?.name?.toLowerCase() === message.authorName.toLowerCase(),
        )
    );
}

function openConversation(conversation: Conversation, isAppeal: boolean): OpenConversation {
    return {
        id: conversation.id ?? "",
        isAppeal,
        isAuto: conversation.isAuto ?? false,
        isArchived: conversation.state === "Archived",
        lastUserUpdate: msOf(conversation.lastUserUpdate),
        lastModUpdate: msOf(conversation.lastModUpdate),
    };
}

/**
 * The subreddit's modmail through Devvit. The app's account moderates every subreddit the app is installed in, so
 * listings name this one.
 */
export function createRedditModmail(reddit: ModmailReddit, subredditName: string | undefined): ModmailReader {
    const subredditOf = async (): Promise<string> =>
        subredditName === undefined || subredditName === "" ? await reddit.getCurrentSubredditName() : subredditName;
    return {
        message: async (message: ModmailMessage): Promise<ReadMessage | undefined> => {
            const { conversation } = await reddit.modMail.getConversation({
                conversationId: message.conversationId,
                markRead: false,
            });
            if (conversation === undefined) {
                return undefined;
            }
            return { subject: conversation.subject ?? "", byAdmin: authorOf(conversation, message)?.isAdmin === true };
        },
        openConversations: async (): Promise<OpenConversations> => {
            const subreddits = [await subredditOf()];
            const folders = await Promise.all(
                OPEN_FOLDERS.map(async ([state, isAppeal]): Promise<readonly [readonly Conversation[], boolean]> => {
                    const { conversations } = await reddit.modMail.getConversations({
                        subreddits,
                        state,
                        limit: CONVERSATIONS_READ,
                    });
                    return [Object.values(conversations), isAppeal];
                }),
            );
            return {
                conversations: folders.flatMap(([listed, isAppeal]): readonly OpenConversation[] =>
                    listed.map((conversation: Conversation): OpenConversation =>
                        openConversation(conversation, isAppeal),
                    ),
                ),
                complete: folders.every(([listed]): boolean => listed.length < CONVERSATIONS_READ),
            };
        },
    };
}
