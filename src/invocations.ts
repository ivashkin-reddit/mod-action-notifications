import type { AppContext, PlatformContext } from "./composition.js";
import type { MenuContext, PlatformMenuContext } from "./menuActions.js";
import { createMeter, metered } from "./meter.js";
import type { Meter } from "./meter.js";
import type { SlackFetch } from "./slack/delivery.js";

/**
 * The composition root's invocations: what main.ts wraps every handler in. Each invocation of a trigger, scheduler job,
 * menu item or form has its Devvit APIs and Slack's fetch counted and timed by a meter (meter.ts), and ends with a
 * completion line: what it did, how long it took and what it cost, under a correlation id.
 *
 * Devvit keeps an installation's logs for 7 days, up to 5,000 entries: about 30 an hour. A line for every event would
 * push every error out within hours on a busy subreddit. So the line is logged for every invocation only while the
 * Debug Logging setting is on, and otherwise only for one that failed (an error), or took SLOW_MS or more (a warning).
 * Those are limited to one a minute for each handler and kind, each saying how many were held back since the last:
 * an outage that fails or slows every event would otherwise log every one.
 */

/**
 * An invocation this long or longer logs its completion line as a warning, with its slowest call: two thirds of the
 * 30 seconds Devvit documents as its execution timeout (for Devvit Web, and in its Redis guide; it documents none for
 * Blocks handlers). A drain of the Slack outbox takes up to about 12 seconds: its 10-second budget and a last call.
 */
export const SLOW_MS = 20_000;
/** A failed or slow line for a handler is logged at most this often; those in between are counted in the next. */
const LINE_INTERVAL_MS = 60_000;
/** A message longer than this is cut: one from something other than the app could be anything. */
const MESSAGE_LOGGED = 100;
/** Eight base-36 characters: enough to tell apart the invocations in a week of one installation's logs. */
const ID_LENGTH = 8;
const BASE36 = 36;
const ID_START = 2;

function correlationId(): string {
    return Math.random()
        .toString(BASE36)
        .slice(ID_START, ID_START + ID_LENGTH)
        .padEnd(ID_LENGTH, "0");
}

/** Slack's fetch, counted: the global one, looked up at each call. */
function meteredFetch(meter: Meter): SlackFetch {
    return async (url: string, init: Parameters<SlackFetch>[1]): ReturnType<SlackFetch> =>
        await meter.call(
            "slack",
            url.slice(url.lastIndexOf("/") + 1),
            async (): ReturnType<SlackFetch> => await fetch(url, init),
        );
}

/** The context a handler is given: Devvit's, field by field, with every dependency counted, and its invocation. */
function meteredContext(context: PlatformContext, meter: Meter): AppContext {
    return {
        settings: metered(context.settings, "settings", meter),
        redis: metered(context.redis, "redis", meter),
        reddit: metered(context.reddit, "reddit", meter),
        scheduler: metered(context.scheduler, "scheduler", meter),
        subredditId: context.subredditId,
        subredditName: context.subredditName,
        appVersion: context.appVersion,
        fetch: meteredFetch(meter),
        invocation: meter,
    };
}

/** The ID of the object `value` is, when it has one. */
function idOf(value: unknown): string | undefined {
    return typeof value === "object" && value !== null && "id" in value && typeof value.id === "string"
        ? value.id
        : undefined;
}

/** The post, comment or modmail conversation an event is about, by ID; undefined for one about none. */
function targetOf(event: unknown): string | undefined {
    if (typeof event !== "object" || event === null) {
        return undefined;
    }
    const fields = new Map<string, unknown>(Object.entries(event));
    const target = ["targetComment", "targetPost", "comment", "post"]
        .map((name: string): string | undefined => idOf(fields.get(name)))
        .find((id: string | undefined): boolean => id !== undefined);
    const named = fields.get("commentId") ?? fields.get("postId") ?? fields.get("conversationId");
    return target ?? (typeof named === "string" ? named : undefined);
}

/** The event's size as JSON, in bytes; never its content. */
function bytesOf(event: unknown): number | undefined {
    try {
        return new TextEncoder().encode(JSON.stringify(event)).length;
    } catch {
        // Not JSON: an event this app cannot measure.
        return undefined;
    }
}

/** How an invocation ended: it resolved, or it rejected with this error. */
type Outcome = Readonly<{ failed: false }> | Readonly<{ failed: true; error: unknown }>;

/** An invocation under way: its handler's name, event, context, meter, and when it started. */
type Running = Readonly<{ handler: string; event: unknown; context: AppContext; meter: Meter; started: number }>;

/**
 * Debug Logging as each installation last read it, for as long as the process lives: an invocation that reads no
 * settings (a comment deletion, AutoModerator holding something for review) follows it. Losing it only means a line
 * less, until the next invocation that reads the settings.
 */
const debugByInstallation = new Map<string, boolean>();

/** Whether Debug Logging is on for the invocation: as it read it, else as its installation last did. */
function debugFor(running: Running): boolean {
    const read = running.meter.debug();
    if (read !== undefined) {
        debugByInstallation.set(running.context.subredditId, read);
        return read;
    }
    return debugByInstallation.get(running.context.subredditId) ?? false;
}

/**
 * When each handler last logged a failed or slow line, and how many it has held back since, for as long as the process
 * lives. Losing it only means a line more.
 */
const lastLogged = new Map<string, Readonly<{ at: number; heldBack: number }>>();

/** How many lines were held back before this one, when it is due; undefined when it is held back itself. */
function heldBackBefore(key: string, now: number): number | undefined {
    const last = lastLogged.get(key);
    if (last !== undefined && now - last.at < LINE_INTERVAL_MS) {
        lastLogged.set(key, { at: last.at, heldBack: last.heldBack + 1 });
        return undefined;
    }
    lastLogged.set(key, { at: now, heldBack: 0 });
    return last?.heldBack ?? 0;
}

/** The completion line: ids, counts and times only, never content or a username. */
function lineOf(running: Running, outcome: Outcome, facts: Readonly<{ ms: number; heldBack: number }>): string {
    const failed = outcome.failed
        ? {
              error: {
                  ...running.meter.failure(),
                  class: outcome.error instanceof Error ? outcome.error.name : typeof outcome.error,
              },
              message: outcome.error instanceof Error ? outcome.error.message.slice(0, MESSAGE_LOGGED) : undefined,
          }
        : {};
    return `[invocation] ${JSON.stringify({
        id: correlationId(),
        handler: running.handler,
        subreddit: running.context.subredditId,
        target: targetOf(running.event),
        outcome: outcome.failed ? "failed" : "ok",
        ms: facts.ms,
        ...running.meter.tallies(),
        ...failed,
        eventBytes: bytesOf(running.event),
        heldBack: facts.heldBack > 0 ? facts.heldBack : undefined,
    })}`;
}

/** How an invocation ended, as the completion line reports it: failed, slow or neither, and when it ended. */
type Ending = Readonly<{ outcome: Outcome; ms: number; slow: boolean; now: number }>;

/**
 * How many lines were held back before this invocation's, when one is due: always for a failed invocation or a slow one,
 * at most a minute apart for each handler, and for every invocation while Debug Logging is on. Undefined when none is.
 */
function dueAfter(running: Running, { outcome, slow, now }: Ending): number | undefined {
    if (debugFor(running)) {
        return 0;
    }
    return outcome.failed || slow
        ? heldBackBefore(`${running.handler} ${outcome.failed ? "failed" : "slow"}`, now)
        : undefined;
}

/** Logs a line at its level: an error when the invocation failed, a warning when slow, else information. */
function logAt(line: string, { outcome, slow }: Ending): void {
    if (outcome.failed) {
        console.error(line);
    } else if (slow) {
        console.warn(line);
    } else {
        console.info(line);
    }
}

/** Logs the completion line, when it is due. */
function complete(running: Running, outcome: Outcome): void {
    const now = Date.now();
    const ms = now - running.started;
    const ending: Ending = { outcome, ms, slow: ms >= SLOW_MS, now };
    const heldBack = dueAfter(running, ending);
    if (heldBack !== undefined) {
        logAt(lineOf(running, outcome, { ms, heldBack }), ending);
    }
}

/** Runs a handler as one invocation, with its completion line; resolves or rejects as the handler does. */
async function invoke(running: Running, run: () => Promise<void>): Promise<void> {
    try {
        await run();
    } catch (error) {
        complete(running, { failed: true, error });
        throw error;
    }
    complete(running, { failed: false });
}

/** A trigger handler run as an invocation named `handler`: the event type. */
export function invoked<E>(
    handler: string,
    run: (event: E, context: AppContext) => Promise<void>,
): (event: E, context: PlatformContext) => Promise<void> {
    return async (event: E, platform: PlatformContext): Promise<void> => {
        const meter = createMeter();
        const context = meteredContext(platform, meter);
        await invoke({ handler, event, context, meter, started: Date.now() }, async (): Promise<void> => {
            await run(event, context);
        });
    };
}

/** A scheduler job run as an invocation named for the job. */
export function invokedJob(
    name: string,
    run: (context: AppContext, event: unknown) => Promise<void>,
): (event: unknown, context: PlatformContext) => Promise<void> {
    return invoked(name, async (event: unknown, context: AppContext): Promise<void> => {
        await run(context, event);
    });
}

/** A menu item or form handler run as an invocation named `handler`, with the moderator-facing parts of the context. */
export function invokedFromMenu<E>(
    handler: string,
    run: (event: E, context: MenuContext) => Promise<void>,
): (event: E, context: PlatformMenuContext) => Promise<void> {
    return async (event: E, platform: PlatformMenuContext): Promise<void> => {
        const meter = createMeter();
        const context: MenuContext = {
            ...meteredContext(platform, meter),
            reddit: metered(platform.reddit, "reddit", meter),
            ui: platform.ui,
        };
        await invoke({ handler, event, context, meter, started: Date.now() }, async (): Promise<void> => {
            await run(event, context);
        });
    };
}
