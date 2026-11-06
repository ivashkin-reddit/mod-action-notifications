/** What was counted on one UTC day. Holds no username. */
export interface DayCounts {
    /** Actions, by who took them and their type: "{actor}:{type}". */
    readonly actions: Readonly<Record<string, number>>;
    /** Moderators' actions, by UTC hour: "0" to "23". */
    readonly hours: Readonly<Record<string, number>>;
    /** Bans and unbans: bans, temporary, permanent, banDays (the temporary bans' days), unbans. */
    readonly bans: Readonly<Record<string, number>>;
    /** Hashes of the moderators who acted. */
    readonly moderators: readonly string[];
    /** Removals on each post. */
    readonly threads: readonly Readonly<{ postId: string; removals: number }>[];
}
