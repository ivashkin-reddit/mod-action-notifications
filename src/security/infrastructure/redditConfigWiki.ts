import type { TriggerContext } from "@devvit/public-api";
import type { ConfigWiki } from "../application/ports.js";
import { CONFIG_PAGE } from "../domain/watch.js";
import type { ConfigRevision } from "../domain/watch.js";

/** The latest revision, and the one before it: enough to see what an edit changed. */
const REVISIONS_READ = 2;

type WikiReddit = Readonly<
    Pick<TriggerContext["reddit"], "getCurrentSubredditName" | "getWikiPageRevisions" | "getWikiPage">
>;

/** A revision as Devvit lists it: what this adapter reads. */
type ListedRevision = Readonly<{
    id: string;
    date: Date;
    reason: string;
    author: Readonly<{ username: string }> | undefined;
}>;

/** A wiki revision's ID as Devvit types it: a UUID, five parts joined by hyphens. */
type RevisionId = `${string}-${string}-${string}-${string}-${string}`;
const REVISION_ID_PARTS = 5;

function isRevisionId(id: string): id is RevisionId {
    return id.split("-").length >= REVISION_ID_PARTS;
}

/** AutoModerator's config page through Devvit's wiki API. */
export function createRedditConfigWiki(reddit: WikiReddit): ConfigWiki {
    const subredditOf = async (named: string | undefined): Promise<string> =>
        named === undefined || named === "" ? await reddit.getCurrentSubredditName() : named;
    return {
        latestRevisions: async (subredditName: string | undefined): Promise<readonly ConfigRevision[]> => {
            const listing = reddit.getWikiPageRevisions({
                subredditName: await subredditOf(subredditName),
                page: CONFIG_PAGE,
                limit: REVISIONS_READ,
            });
            return (await listing.get(REVISIONS_READ)).map(
                ({ id, date, reason, author }: ListedRevision): ConfigRevision => ({
                    id,
                    date,
                    reason,
                    author: author?.username ?? "",
                }),
            );
        },
        revisionText: async (subredditName: string | undefined, revisionId: string): Promise<string> => {
            if (!isRevisionId(revisionId)) {
                throw new Error(`${revisionId} is not a wiki revision ID`);
            }
            return (await reddit.getWikiPage(await subredditOf(subredditName), CONFIG_PAGE, { revisionId })).content;
        },
    };
}
