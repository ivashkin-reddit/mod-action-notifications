/**
 * The composition root's meter: one for each invocation, counting and timing every call it makes to a dependency.
 * invocations.ts wraps a handler's Devvit APIs and Slack's fetch in it, and reports its tallies in the completion line.
 */

/** The dependencies an invocation's calls are counted against. */
export type Dependency = "redis" | "reddit" | "settings" | "scheduler" | "slack";

const DEPENDENCIES: readonly Dependency[] = ["redis", "reddit", "settings", "scheduler", "slack"];

/** What an invocation tells its meter as it goes. */
export interface Invocation {
    /** Notes the Debug Logging setting as the invocation read it. */
    readonly noteDebug: (on: boolean) => void;
    /** Notes an alert handed to the outbox. */
    readonly noteAlert: () => void;
}

/** One dependency's calls in an invocation: how many, how long in all, and how many rejected. */
type Tally = Readonly<{ calls: number; ms: number; failures: number }>;

/** Each dependency's tally. */
type Tallies = Readonly<Record<Dependency, Tally>>;

const NO_CALLS: Tally = { calls: 0, ms: 0, failures: 0 };

/** What a meter has seen so far. */
type Seen = Readonly<{
    tallies: Tallies;
    slowest: Readonly<{ call: string; ms: number }> | undefined;
    lastCall: string | undefined;
    lastFailure: string | undefined;
    alerts: number;
    debug: boolean;
}>;

const NOTHING_SEEN: Seen = {
    tallies: { redis: NO_CALLS, reddit: NO_CALLS, settings: NO_CALLS, scheduler: NO_CALLS, slack: NO_CALLS },
    slowest: undefined,
    lastCall: undefined,
    lastFailure: undefined,
    alerts: 0,
    debug: false,
};

/** A call as the meter tracks it: its dependency, its name (`redis.get`), and when it started. */
type Call = Readonly<{ dependency: Dependency; name: string; started: number }>;

function withTally(tallies: Tallies, dependency: Dependency, change: (before: Tally) => Tally): Tallies {
    return { ...tallies, [dependency]: change(tallies[dependency]) };
}

/** `seen`, with a call made. */
function begun(seen: Seen, call: Call): Seen {
    return {
        ...seen,
        tallies: withTally(seen.tallies, call.dependency, (tally: Tally): Tally => ({
            ...tally,
            calls: tally.calls + 1,
        })),
        lastCall: call.name,
    };
}

/** `seen`, with a call settled: its time, and whether it rejected. */
function settled(seen: Seen, call: Call, failed: boolean): Seen {
    const ms = Date.now() - call.started;
    return {
        ...seen,
        tallies: withTally(seen.tallies, call.dependency, (tally: Tally): Tally => ({
            ...tally,
            ms: tally.ms + ms,
            failures: tally.failures + (failed ? 1 : 0),
        })),
        slowest: seen.slowest === undefined || ms > seen.slowest.ms ? { call: call.name, ms } : seen.slowest,
        lastFailure: failed ? call.name : seen.lastFailure,
    };
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return (
        (typeof value === "object" || typeof value === "function") &&
        value !== null &&
        "then" in value &&
        typeof value.then === "function"
    );
}

/** How a meter changes what it has seen. */
type Update = (change: (seen: Seen) => Seen) => void;

/** Runs the call, tallying it as failed when it throws. */
function attempt<T>(update: Update, call: Call, run: () => T): T {
    try {
        return run();
    } catch (error) {
        update((seen: Seen): Seen => settled(seen, call, true));
        throw error;
    }
}

/** Runs a call and tallies it when it settles, before the caller sees it settle. */
function counted<T>(update: Update, call: Call, run: () => T): T {
    update((seen: Seen): Seen => begun(seen, call));
    const result = attempt(update, call, run);
    if (!isPromiseLike(result)) {
        update((seen: Seen): Seen => settled(seen, call, false));
        return result;
    }
    // Registered before the caller's own, so it has run by the time the caller goes on.
    result.then(
        (): void => {
            update((seen: Seen): Seen => settled(seen, call, false));
        },
        (): void => {
            update((seen: Seen): Seen => settled(seen, call, true));
        },
    );
    return result;
}

/** What failed: the dependency whose call rejected last, or the app's own code, and where. */
export type FailureCode = Readonly<{ code: string; stage: string }>;

/** An invocation's meter: its calls, and the facts the completion line reports. */
export type Meter = Invocation &
    Readonly<{
        /** Counts and times a call; `name` is the dependency's method, `modMail.getConversations` for a nested one. */
        call: <T>(dependency: Dependency, name: string, run: () => T) => T;
        /** Whether the invocation read Debug Logging as on. */
        debug: () => boolean;
        /** The tallies and facts for the completion line. */
        tallies: () => Readonly<Record<string, unknown>>;
        /** What failed, for an invocation that rejected. */
        failure: () => FailureCode;
    }>;

/** The completion line's tallies: each dependency's calls and time, the failures, alerts and the slowest call. */
function talliesOf(seen: Seen): Readonly<Record<string, unknown>> {
    const tallies = DEPENDENCIES.map((dependency: Dependency): readonly [Dependency, Tally] => [
        dependency,
        seen.tallies[dependency],
    ]);
    return {
        ...Object.fromEntries(
            tallies.map(
                ([dependency, { calls, ms }]: readonly [Dependency, Tally]): [
                    Dependency,
                    Readonly<{ n: number; ms: number }>,
                ] => [dependency, { n: calls, ms }],
            ),
        ),
        failedCalls: tallies.reduce(
            (sum: number, [, { failures }]: readonly [Dependency, Tally]): number => sum + failures,
            0,
        ),
        alerts: seen.alerts,
        slowest: seen.slowest === undefined ? undefined : `${seen.slowest.call} ${String(seen.slowest.ms)}ms`,
        lastCall: seen.lastCall,
    };
}

function failureOf(seen: Seen): FailureCode {
    const [dependency = ""] = (seen.lastFailure ?? "").split(".");
    return { code: dependency === "" ? "internal" : `${dependency}-failed`, stage: seen.lastFailure ?? "app" };
}

export function createMeter(): Meter {
    let seen = NOTHING_SEEN;
    const update: Update = (change: (current: Seen) => Seen): void => {
        seen = change(seen);
    };
    return {
        noteDebug: (on: boolean): void => {
            update((current: Seen): Seen => ({ ...current, debug: on }));
        },
        noteAlert: (): void => {
            update((current: Seen): Seen => ({ ...current, alerts: current.alerts + 1 }));
        },
        debug: (): boolean => seen.debug,
        call: <T>(dependency: Dependency, name: string, run: () => T): T =>
            counted(update, { dependency, name: `${dependency}.${name}`, started: Date.now() }, run),
        tallies: (): Readonly<Record<string, unknown>> => talliesOf(seen),
        failure: (): FailureCode => failureOf(seen),
    };
}

/** What a dependency's calls are counted against, and under what name prefix (`modMail.` for Reddit's modmail). */
type Metering = Readonly<{ dependency: Dependency; meter: Meter; prefix: string }>;

/** `target` with each of its methods counted, and each of its objects likewise; methods run on `target` itself. */
function meteredWith<T extends object>(target: T, metering: Metering): T {
    return new Proxy(target, {
        get: (object: T, property: string | symbol): unknown => {
            const value: unknown = Reflect.get(object, property, object);
            if (typeof property !== "string") {
                return value;
            }
            if (typeof value === "function") {
                return (...args: readonly unknown[]): unknown =>
                    metering.meter.call(metering.dependency, `${metering.prefix}${property}`, (): unknown =>
                        Reflect.apply(value, object, args),
                    );
            }
            return typeof value === "object" && value !== null
                ? meteredWith(value, { ...metering, prefix: `${metering.prefix}${property}.` })
                : value;
        },
    });
}

/**
 * `target` with each of its methods counted and timed against `dependency`, and each of its objects (Reddit's
 * `modMail`) likewise. Methods run on `target` itself, so private fields still work. A Reddit listing's pages are
 * fetched by the listing, after the call that made it: they count as that one call.
 */
export function metered<T extends object>(target: T, dependency: Dependency, meter: Meter): T {
    return meteredWith(target, { dependency, meter, prefix: "" });
}
