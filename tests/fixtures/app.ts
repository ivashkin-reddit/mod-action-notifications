import { vi } from "vitest";
import { BOT_TOKEN, createFakeContext, defaultSettings } from "./fakeContext.js";
import type { CreatedContext, FakeContext, Settings, ShownForm, Toast } from "./fakeContext.js";
import type { FakeDevvit, FormDefinition, Handler, Registrations } from "./fakeDevvit.js";
import type { FakeRedis } from "./fakeRedis.js";
import type { ScheduledJob } from "./fakeScheduler.js";
import { createFakeSlack, WORKSPACE } from "./fakeSlack.js";
import type { FakeSlack } from "./fakeSlack.js";

/** The instant every test starts at. Fake timers hold the clock here until a test advances it. */
export const NOW = new Date("2026-11-04T12:00:00.000Z");

/**
 * What a test sets up an installation with: its settings, and the bot token its moderators connected with Connect
 * Slack, BOT_TOKEN unless the test says otherwise (undefined or  for none).
 */
export type Setup = Settings & Readonly<{ connectedToken?: string | undefined }>;

/** Stores a connection to WORKSPACE with `token`, as Connect Slack does once Slack takes it. */
export function connect(redis: Readonly<Pick<FakeRedis, "seed">>, token = BOT_TOKEN): void {
    redis.seed("slack_connection", JSON.stringify({ token, team: WORKSPACE }));
}

export type App = Readonly<{
    /** What the app registered with Devvit. */
    registrations: Registrations;
    /** The installation's settings. Changing a value here changes what the app reads next. */
    settings: Settings;
    context: FakeContext;
    slack: FakeSlack;
    toasts: readonly Toast[];
    /**
     * Delivers a trigger event to the handler registered for it, in this installation or in `installation` (another
     * context from createFakeContext).
     */
    fire: (event: string, payload: unknown, installation?: unknown) => Promise<void>;
    /** Runs a scheduler job the way the scheduler would. */
    runJob: (name: string) => Promise<void>;
    /**
     * Runs, oldest first and with their data, the one-off jobs named `name` whose time has come, as the scheduler would,
     * and any of them schedules that are due at once; returns how many ran.
     */
    runDueJobs: (name: string) => Promise<number>;
    /** Presses a menu item by its label. */
    pressMenuItem: (label: string) => Promise<void>;
    /** The form the app most recently showed with ui.showForm. */
    shownForm: () => Readonly<{ key: string; definition: FormDefinition }>;
    /** Submits a form with the values a moderator entered. */
    submitForm: (key: string, values: Readonly<Record<string, unknown>>) => Promise<void>;
    /** Presses a menu item, then submits the form it shows with `values`. */
    fillForm: (menuItem: string, values: Readonly<Record<string, unknown>>) => Promise<void>;
    /** Moves the clock forward, running any timers that fall due. */
    advance: (ms: number) => Promise<void>;
    /** Connects the installation to WORKSPACE with `token`, as Connect Slack does once Slack takes it. */
    connectSlack: (token: string) => void;
}>;

const STILL_RUNNING = Symbol("still running");

/**
 * Settles `work`, advancing fake time only while it waits on a timer (a Slack retry backoff), so delays happen
 * exactly as long as the app asks for.
 */
export async function drive(work: Readonly<Promise<void>>): Promise<void> {
    const outcome = await Promise.race([
        work,
        vi.advanceTimersToNextTimerAsync().then((): typeof STILL_RUNNING => STILL_RUNNING),
    ]);
    if (outcome === STILL_RUNNING) {
        await drive(work);
    }
}

function named<T>(registry: Readonly<Record<string, T>>, kind: string, name: string): T {
    const entry = registry[name];
    if (entry === undefined) {
        throw new Error(`no ${kind} named ${name}`);
    }
    return entry;
}

async function invoke(handler: Handler, event: unknown, context: unknown): Promise<void> {
    await drive(Promise.resolve(handler(event, context)));
}

/** The form the app most recently showed, built from the data it showed it with when the app gave a function. */
function shownFormIn(registrations: Registrations, shownForms: readonly ShownForm[]): App["shownForm"] {
    return (): Readonly<{ key: string; definition: FormDefinition }> => {
        const shown = shownForms[shownForms.length - 1];
        if (shown === undefined) {
            throw new Error("no form has been shown");
        }
        const source = named(registrations.forms, "form", shown.key).definition;
        return { key: shown.key, definition: typeof source === "function" ? source(shown.data) : source };
    };
}

type Actions = Pick<App, "fire" | "runJob" | "pressMenuItem" | "shownForm" | "submitForm" | "fillForm" | "advance">;

/** What a test can do to the app: deliver what Devvit would, and move the clock. */
function actions(registrations: Registrations, context: unknown, shownForms: readonly ShownForm[]): Actions {
    const shownForm = shownFormIn(registrations, shownForms);
    const pressMenuItem = async (label: string): Promise<void> => {
        const item = registrations.menuItems.find((menuItem): boolean => menuItem.label === label);
        if (item === undefined) {
            throw new Error(`no menu item labelled ${label}`);
        }
        await invoke(item.onPress, { location: "subreddit", targetId: "t5_testsub" }, context);
    };
    const submitForm = async (key: string, values: Readonly<Record<string, unknown>>): Promise<void> => {
        await invoke(named(registrations.forms, "form", key).onSubmit, { values }, context);
    };
    return {
        fire: async (event: string, payload: unknown, installation?: unknown): Promise<void> => {
            await invoke(named(registrations.triggers, "trigger", event), payload, installation ?? context);
        },
        runJob: async (name: string): Promise<void> => {
            await invoke(named(registrations.schedulerJobs, "scheduler job", name), { name }, context);
        },
        pressMenuItem,
        shownForm,
        submitForm,
        fillForm: async (menuItem: string, values: Readonly<Record<string, unknown>>): Promise<void> => {
            await pressMenuItem(menuItem);
            await submitForm(shownForm().key, values);
        },
        advance: async (ms: number): Promise<void> => {
            await vi.advanceTimersByTimeAsync(ms);
        },
    };
}

/**
 * Loads src/main.ts afresh, so each test gets a new bot with no cached settings or moderator list, and wires it to
 * fake Devvit services, a fake Slack Web API and a clock frozen at NOW.
 */
/** An installation set up so: its settings, and its Slack connection when it has one. */
function installationOf(setup: Readonly<Setup>): CreatedContext & Readonly<{ settings: Settings }> {
    const { connectedToken, ...settingsOverrides } = { connectedToken: BOT_TOKEN, ...setup };
    const settings: Settings = { ...defaultSettings(), ...settingsOverrides };
    const created = createFakeContext(settings);
    if (connectedToken !== undefined && connectedToken !== "") {
        connect(created.context.redis, connectedToken);
    }
    return { ...created, settings };
}

/** At most this many due jobs run at once: a job that keeps scheduling itself for now would run forever. */
const MAX_DUE_RUNS = 100;

/** The oldest one-off job named `name` whose time has come; undefined when none is due. */
function dueJob(jobs: readonly ScheduledJob[], name: string): ScheduledJob | undefined {
    const due = jobs.filter(
        (job: ScheduledJob): boolean =>
            job.name === name && job.runAt !== undefined && job.runAt.getTime() <= Date.now(),
    );
    return due.sort(
        (first: ScheduledJob, second: ScheduledJob): number => Number(first.runAt) - Number(second.runAt),
    )[0];
}

export async function loadApp(devvit: FakeDevvit, setup: Readonly<Setup> = {}): Promise<App> {
    vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { context, toasts, shownForms, settings } = installationOf(setup);
    const slack = createFakeSlack();
    vi.stubGlobal("fetch", slack.fetch);

    devvit.reset();
    vi.resetModules();
    await import("../../src/main.js");
    const registrations = devvit.registrations();

    return {
        registrations,
        settings,
        context,
        slack,
        toasts,
        connectSlack: (token: string): void => {
            connect(context.redis, token);
        },
        runDueJobs: async (name: string): Promise<number> => {
            const runFrom = async (ran: number): Promise<number> => {
                const job = dueJob(context.scheduler.jobs, name);
                if (job === undefined || ran >= MAX_DUE_RUNS) {
                    return ran;
                }
                // Taken off the schedule as it starts, as the scheduler does: what it schedules is a job of its own.
                context.scheduler.jobs = context.scheduler.jobs.filter(
                    (scheduled: ScheduledJob): boolean => scheduled.id !== job.id,
                );
                await invoke(
                    named(registrations.schedulerJobs, "scheduler job", name),
                    { name, data: job.data },
                    context,
                );
                return await runFrom(ran + 1);
            };
            return await runFrom(0);
        },
        ...actions(registrations, context, shownForms),
    };
}
