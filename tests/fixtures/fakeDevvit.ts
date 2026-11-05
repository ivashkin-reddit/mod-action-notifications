/**
 * Stands in for `Devvit` from @devvit/public-api. It records what the app registers (settings, triggers, scheduler
 * jobs, forms, menu items) so tests can call the same handlers the platform would call.
 *
 * Each test file mocks @devvit/public-api with one instance:
 *
 *   const devvit = await vi.hoisted(async () => (await import('../fixtures/fakeDevvit.js')).createFakeDevvit());
 *   vi.mock('@devvit/public-api', () => ({ Devvit: devvit.api }));
 */

export type Handler = (event: unknown, context: unknown) => Promise<void> | void;

type Option = Readonly<{ label: string; value: string }>;

export type SettingDefinition = Readonly<{
    type: string;
    name: string;
    label: string;
    helpText?: string;
    defaultValue?: unknown;
    options?: readonly Option[];
    multiSelect?: boolean;
    /** "app" for a setting the developer sets for every installation; an installation's own otherwise. */
    scope?: string;
    isSecret?: boolean;
    /** Checks a value as the settings form saves it: a message rejects the value. */
    onValidate?: (event: Readonly<{ value?: unknown; isEditing: boolean }>, context: unknown) => unknown;
}>;

export type MenuItemDefinition = Readonly<{
    label: string;
    location: string;
    forUserType?: string;
    onPress: Handler;
}>;

export type FormDefinition = Readonly<{
    title?: string;
    description?: string;
    fields: readonly Readonly<{
        name: string;
        label?: string;
        type: string;
        defaultValue?: unknown;
        options?: readonly Option[];
        disabled?: boolean;
    }>[];
    acceptLabel?: string;
    cancelLabel?: string;
}>;

/** What Devvit.createForm takes: a form, or a function that builds one from the data ui.showForm passes. */
export type FormSource = FormDefinition | ((data: Readonly<Record<string, unknown>>) => FormDefinition);

export type FormRegistration = Readonly<{ definition: FormSource; onSubmit: Handler }>;

/** What the app registered, by name: one handler per trigger event, scheduler job and form. */
export type Registrations = Readonly<{
    configure: readonly unknown[];
    settings: readonly SettingDefinition[];
    triggers: Readonly<Record<string, Handler>>;
    schedulerJobs: Readonly<Record<string, Handler>>;
    forms: Readonly<Record<string, FormRegistration>>;
    menuItems: readonly MenuItemDefinition[];
}>;

type TriggerDefinition = Readonly<{ event: string; onEvent: Handler }>;

export type FakeDevvit = Readonly<{
    /** What the app sees as `Devvit`. */
    api: Readonly<{
        configure: (config: unknown) => void;
        addSettings: (settings: readonly SettingDefinition[]) => void;
        addTrigger: (definition: TriggerDefinition) => void;
        addSchedulerJob: (job: Readonly<{ name: string; onRun: Handler }>) => void;
        createForm: (definition: FormSource, onSubmit: Handler) => string;
        addMenuItem: (item: MenuItemDefinition) => void;
    }>;
    /** Everything registered since the last `reset()`. */
    registrations: () => Registrations;
    reset: () => void;
}>;

const NOTHING_REGISTERED: Registrations = {
    configure: [],
    settings: [],
    triggers: {},
    schedulerJobs: {},
    forms: {},
    menuItems: [],
};

/** The handlers with `handler` added under `name`, which the app may register only once. */
function withHandler(
    handlers: Readonly<Record<string, Handler>>,
    kind: string,
    { name, handler }: Readonly<{ name: string; handler: Handler }>,
): Readonly<Record<string, Handler>> {
    if (name in handlers) {
        throw new Error(`${kind} ${name} registered twice`);
    }
    return { ...handlers, [name]: handler };
}

export function createFakeDevvit(): FakeDevvit {
    let recorded = NOTHING_REGISTERED;

    return {
        api: {
            configure: (config: unknown): void => {
                recorded = { ...recorded, configure: [...recorded.configure, config] };
            },
            addSettings: (settings: readonly SettingDefinition[]): void => {
                recorded = { ...recorded, settings: [...recorded.settings, ...settings] };
            },
            addTrigger: ({ event, onEvent }: TriggerDefinition): void => {
                const triggers = withHandler(recorded.triggers, "trigger", { name: event, handler: onEvent });
                recorded = { ...recorded, triggers };
            },
            addSchedulerJob: ({ name, onRun }: Readonly<{ name: string; onRun: Handler }>): void => {
                const schedulerJobs = withHandler(recorded.schedulerJobs, "scheduler job", { name, handler: onRun });
                recorded = { ...recorded, schedulerJobs };
            },
            createForm: (definition: FormSource, onSubmit: Handler): string => {
                const key = `form.${String(Object.keys(recorded.forms).length)}`;
                recorded = { ...recorded, forms: { ...recorded.forms, [key]: { definition, onSubmit } } };
                return key;
            },
            addMenuItem: (item: MenuItemDefinition): void => {
                recorded = { ...recorded, menuItems: [...recorded.menuItems, item] };
            },
        },
        registrations: (): Registrations => recorded,
        reset: (): void => {
            recorded = NOTHING_REGISTERED;
        },
    };
}
