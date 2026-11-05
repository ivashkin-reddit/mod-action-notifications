/**
 * The fake Redis's keyspace: what each key holds, and when it expires. Like Redis, a command against a key holding
 * another kind of value rejects with WRONGTYPE.
 */

export const MS_PER_SECOND = 1000;
const WRONG_TYPE = "WRONGTYPE Operation against a key holding the wrong kind of value";

/** A sorted set's scores by member. */
export type Scores = Readonly<Record<string, number>>;
/** A hash's values by field. */
export type Fields = Readonly<Record<string, string>>;

/** What a key holds: a string, a sorted set or a hash. */
export type Value =
    | Readonly<{ kind: "string"; text: string }>
    | Readonly<{ kind: "zset"; scores: Scores }>
    | Readonly<{ kind: "hash"; fields: Fields }>;

export type Entry = Readonly<{ value: Value; expiresAt: number | undefined }>;

/** The keys and what they hold; `live` drops a key that has expired. */
export type Keyspace = Readonly<{
    live: (key: string) => Entry | undefined;
    put: (key: string, entry: Entry) => void;
    drop: (key: string) => void;
    keys: () => readonly string[];
}>;

export function createKeyspace(): Keyspace {
    const entries = new Map<string, Entry>();
    const live = (key: string): Entry | undefined => {
        const entry = entries.get(key);
        if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
            entries.delete(key);
            return undefined;
        }
        return entry;
    };
    return {
        live,
        put: (key: string, entry: Entry): void => {
            entries.set(key, entry);
        },
        drop: (key: string): void => {
            entries.delete(key);
        },
        keys: (): readonly string[] => [...entries.keys()].filter((key: string): boolean => live(key) !== undefined),
    };
}

/** The string at `key`; undefined when there is none. */
export function textAt({ live }: Keyspace, key: string): string | undefined {
    const value = live(key)?.value;
    if (value === undefined) {
        return undefined;
    }
    if (value.kind !== "string") {
        throw new TypeError(WRONG_TYPE);
    }
    return value.text;
}

/** The sorted set at `key`; {} when there is none. */
export function scoresAt({ live }: Keyspace, key: string): Scores {
    const value = live(key)?.value;
    if (value === undefined) {
        return {};
    }
    if (value.kind !== "zset") {
        throw new TypeError(WRONG_TYPE);
    }
    return value.scores;
}

/** The hash at `key`; {} when there is none. */
export function fieldsAt({ live }: Keyspace, key: string): Fields {
    const value = live(key)?.value;
    if (value === undefined) {
        return {};
    }
    if (value.kind !== "hash") {
        throw new TypeError(WRONG_TYPE);
    }
    return value.fields;
}

/** Stores `value` at `key`, keeping its expiry; like Redis, an emptied sorted set or hash goes. */
export function keep(keyspace: Keyspace, key: string, value: Value): void {
    const empty =
        (value.kind === "zset" && Object.keys(value.scores).length === 0) ||
        (value.kind === "hash" && Object.keys(value.fields).length === 0);
    if (empty) {
        keyspace.drop(key);
        return;
    }
    keyspace.put(key, { value, expiresAt: keyspace.live(key)?.expiresAt });
}
