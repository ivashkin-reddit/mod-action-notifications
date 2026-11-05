import { vi } from "vitest";
import type { Mock } from "vitest";
import { fieldsAt, keep } from "./fakeRedisKeyspace.js";
import type { Keyspace } from "./fakeRedisKeyspace.js";

/** The fake Redis's hash commands, as Redis behaves for them. */
export interface HashCommands {
    /** Sets the field unless the hash has it: 1 when it set it, 0 when the field was there. */
    readonly hSetNX: Mock<(key: string, field: string, value: string) => Promise<number>>;
    readonly hGet: Mock<(key: string, field: string) => Promise<string | undefined>>;
    /** Every field and value; {} when there is no hash. */
    readonly hGetAll: Mock<(key: string) => Promise<Record<string, string>>>;
    /** Removes the fields and returns how many the hash had. */
    readonly hDel: Mock<(key: string, fields: readonly string[]) => Promise<number>>;
}

/** The hash's fields, through a Map: a field named like an Object property ("constructor") is not in the hash. */
function fieldMap(keyspace: Keyspace, key: string): Map<string, string> {
    return new Map(Object.entries(fieldsAt(keyspace, key)));
}

export function hashCommands(keyspace: Keyspace): HashCommands {
    return {
        hSetNX: vi.fn(async (key: string, field: string, value: string): Promise<number> => {
            const fields = fieldMap(keyspace, key);
            if (fields.has(field)) {
                return await Promise.resolve(0);
            }
            keep(keyspace, key, { kind: "hash", fields: { ...fieldsAt(keyspace, key), [field]: value } });
            return await Promise.resolve(1);
        }),
        hGet: vi.fn(
            async (key: string, field: string): Promise<string | undefined> =>
                await Promise.resolve(fieldMap(keyspace, key).get(field)),
        ),
        hGetAll: vi.fn(
            async (key: string): Promise<Record<string, string>> =>
                await Promise.resolve({ ...fieldsAt(keyspace, key) }),
        ),
        hDel: vi.fn(async (key: string, fields: readonly string[]): Promise<number> => {
            const all = fieldMap(keyspace, key);
            const removed = fields.filter((field: string): boolean => all.delete(field)).length;
            keep(keyspace, key, { kind: "hash", fields: Object.fromEntries(all) });
            return await Promise.resolve(removed);
        }),
    };
}
