import type { ConfigEdit, ConfigRevision } from "../domain/watch.js";

/** What the security watch keeps between actions. Moderators are named lower-cased. Each method rejects when storage fails. */
export interface SecurityStore {
    /** When the moderator last acted, in ms since the epoch; undefined for one not seen. */
    readonly lastAction: (moderator: string) => Promise<number | undefined>;
    readonly noteAction: (moderator: string, at: number) => Promise<void>;
    readonly forgetModerator: (moderator: string) => Promise<void>;
    /** Claims the alert that the moderator woke: true the first time in a day. Safe for actions handled at once. */
    readonly claimWake: (moderator: string) => Promise<boolean>;
    /** Counts one of AutoModerator's removals, at `at`, in its minute. Atomic. */
    readonly countAutoModRemoval: (at: number) => Promise<void>;
    /** AutoModerator's removals from minute `from` to minute `to` since the epoch, as (minute, count). */
    readonly autoModRemovals: (from: number, to: number) => Promise<readonly (readonly [number, number])[]>;
    readonly noteConfigEdit: (edit: ConfigEdit) => Promise<void>;
    /** The last edit to AutoModerator's config noted within the day, if any. */
    readonly lastConfigEdit: () => Promise<ConfigEdit | undefined>;
    /** Claims the alert for an edit to the config, by its revision: true the first time in a day. */
    readonly claimConfigEdit: (revisionId: string) => Promise<boolean>;
    /** Claims the misfire alert for the edit at `editAt`: true the first time. */
    readonly claimMisfire: (editAt: number) => Promise<boolean>;
}

/** AutoModerator's config page in the subreddit's wiki. Each method rejects when the wiki cannot be read. */
export interface ConfigWiki {
    /** Its latest two revisions, newest first; fewer for a page with fewer. */
    readonly latestRevisions: (subredditName: string | undefined) => Promise<readonly ConfigRevision[]>;
    /** Its text at a revision. */
    readonly revisionText: (subredditName: string | undefined, revisionId: string) => Promise<string>;
}

export interface WokeAlert {
    readonly moderator: string;
    readonly days: number;
    readonly lastAt: number;
    readonly type: string;
}

export interface ConfigEditedAlert {
    readonly moderator: string;
    readonly reason: string;
    readonly added: number;
    readonly removed: number;
    readonly subredditName: string | undefined;
}

export interface MisfireAlert {
    readonly editor: string;
    readonly removals: number;
    readonly hourlyAverage: number;
    readonly subredditName: string | undefined;
}

/** Security alerts, sent to the alert channel. Delivery may come later; none rejects. */
export interface SecurityAlerts {
    readonly moderatorWoke: (alert: WokeAlert) => Promise<void>;
    readonly configEdited: (alert: ConfigEditedAlert) => Promise<void>;
    readonly misfiring: (alert: MisfireAlert) => Promise<void>;
}
