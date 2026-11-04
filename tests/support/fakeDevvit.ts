/**
 * Stands in for `Devvit` from @devvit/public-api. It records what the app registers (settings, triggers,
 * scheduler jobs, forms, menu items) so tests can call the same handlers the platform would call.
 *
 * Each test file mocks @devvit/public-api with one instance:
 *
 *   const devvit = await vi.hoisted(async () => (await import('./support/fakeDevvit')).createFakeDevvit());
 *   vi.mock('@devvit/public-api', () => ({ Devvit: devvit.api }));
 */

export type Handler = (event: unknown, context: unknown) => Promise<void> | void;

export interface SettingDefinition {
  type: string;
  name: string;
  label: string;
  helpText?: string;
  defaultValue?: unknown;
  options?: { label: string; value: string }[];
  multiSelect?: boolean;
}

export interface MenuItemDefinition {
  label: string;
  location: string | string[];
  forUserType?: string;
  onPress: Handler;
}

export interface FormDefinition {
  title?: string;
  description?: string;
  fields: { name: string; label?: string; type: string; defaultValue?: unknown; options?: { label: string; value: string }[] }[];
  acceptLabel?: string;
  cancelLabel?: string;
}

export interface Registrations {
  configure: unknown[];
  settings: SettingDefinition[];
  triggers: Map<string, Handler[]>;
  schedulerJobs: Map<string, Handler>;
  forms: Map<string, { definition: FormDefinition; onSubmit: Handler }>;
  menuItems: MenuItemDefinition[];
}

interface TriggerDefinition {
  event?: string;
  events?: string[];
  onEvent: Handler;
}

export interface FakeDevvit {
  /** What the app sees as `Devvit`. */
  readonly api: {
    configure(config: unknown): void;
    addSettings(settings: SettingDefinition[]): void;
    addTrigger(definition: TriggerDefinition): void;
    addSchedulerJob(job: { name: string; onRun: Handler }): void;
    createForm(definition: FormDefinition, onSubmit: Handler): string;
    addMenuItem(item: MenuItemDefinition): void;
  };
  /** Everything registered since the last `reset()`. */
  readonly registrations: Registrations;
  reset(): void;
}

function emptyRegistrations(): Registrations {
  return {
    configure: [],
    settings: [],
    triggers: new Map(),
    schedulerJobs: new Map(),
    forms: new Map(),
    menuItems: [],
  };
}

export function createFakeDevvit(): FakeDevvit {
  let registrations = emptyRegistrations();

  const api: FakeDevvit['api'] = {
    configure(config) {
      registrations.configure.push(config);
    },
    addSettings(settings) {
      registrations.settings.push(...settings);
    },
    addTrigger(definition) {
      const events = definition.events ?? (definition.event === undefined ? [] : [definition.event]);
      for (const event of events) {
        registrations.triggers.set(event, [...(registrations.triggers.get(event) ?? []), definition.onEvent]);
      }
    },
    addSchedulerJob(job) {
      if (registrations.schedulerJobs.has(job.name)) {
        throw new Error(`scheduler job ${job.name} registered twice`);
      }
      registrations.schedulerJobs.set(job.name, job.onRun);
    },
    createForm(definition, onSubmit) {
      const key = `form.${registrations.forms.size}`;
      registrations.forms.set(key, { definition, onSubmit });
      return key;
    },
    addMenuItem(item) {
      registrations.menuItems.push(item);
    },
  };

  return {
    api,
    get registrations() {
      return registrations;
    },
    reset() {
      registrations = emptyRegistrations();
    },
  };
}
