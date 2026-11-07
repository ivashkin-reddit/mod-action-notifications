import { vi } from "vitest";
import type { Mock } from "vitest";

/** A revision of AutoModerator's config page (`config/automoderator`), as a test sets it up. */
export interface FakeWikiRevision {
    readonly id: string;
    readonly date: Date;
    readonly author: string;
    readonly reason: string;
    readonly content: string;
}

/** A revision as `reddit.getWikiPageRevisions(...).get(n)` returns it: what the app reads. */
export type ListedRevision = Readonly<{
    id: string;
    date: Date;
    reason: string;
    author: Readonly<{ username: string }>;
}>;

type RevisionsQuery = Readonly<{ subredditName: string; page: string; limit: number }>;

/** The wiki's methods in the fake Reddit client. */
export interface FakeWikiMethods {
    readonly getWikiPageRevisions: Mock<
        (query: RevisionsQuery) => Readonly<{ get: (count: number) => Promise<readonly ListedRevision[]> }>
    >;
    /** The page's text at a revision, or at its latest; rejects for a revision the wiki does not hold. */
    readonly getWikiPage: Mock<
        (
            subredditName: string,
            page: string,
            options?: Readonly<{ revisionId?: string }>,
        ) => Promise<Readonly<{ content: string }>>
    >;
}

/** The wiki's methods, reading AutoModerator's config revisions, newest first, from the state when called. */
export function wikiOf(revisions: () => readonly FakeWikiRevision[]): FakeWikiMethods {
    return {
        getWikiPageRevisions: vi.fn((): Readonly<{ get: (count: number) => Promise<readonly ListedRevision[]> }> => ({
            get: async (count: number): Promise<readonly ListedRevision[]> =>
                await Promise.resolve(
                    revisions()
                        .slice(0, count)
                        .map(({ id, date, reason, author }: FakeWikiRevision): ListedRevision => ({
                            id,
                            date,
                            reason,
                            author: { username: author },
                        })),
                ),
        })),
        getWikiPage: vi.fn(
            async (
                _subredditName: string,
                _page: string,
                options?: Readonly<{ revisionId?: string }>,
            ): Promise<Readonly<{ content: string }>> => {
                const revision = revisions().find(({ id }: FakeWikiRevision, index: number): boolean =>
                    options?.revisionId === undefined ? index === 0 : id === options.revisionId,
                );
                if (revision === undefined) {
                    throw new Error(`no wiki revision ${options?.revisionId ?? "latest"}`);
                }
                return await Promise.resolve({ content: revision.content });
            },
        ),
    };
}
