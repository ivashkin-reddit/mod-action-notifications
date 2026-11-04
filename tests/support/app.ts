import { vi } from 'vitest';
import { createFakeContext, defaultSettings, type FakeContext, type Settings, type Toast } from './fakeContext';
import type { FakeDevvit, FormDefinition, Registrations } from './fakeDevvit';
import { FakeSlack } from './fakeSlack';

/** The instant every test starts at. Fake timers hold the clock here until a test advances it. */
export const NOW = new Date('2026-11-04T12:00:00.000Z');

export interface App {
  /** What the app registered with Devvit. */
  readonly registrations: Registrations;
  /** The installation's settings. Changing a value here changes what the app reads next. */
  readonly settings: Settings;
  readonly context: FakeContext;
  readonly slack: FakeSlack;
  readonly toasts: Toast[];
  /** Delivers a trigger event to every handler registered for it. */
  fire(event: string, payload: object): Promise<void>;
  /** Runs a scheduler job the way the scheduler would. */
  runJob(name: string): Promise<void>;
  /** Presses a menu item by its label. */
  pressMenuItem(label: string): Promise<void>;
  /** The form the app most recently showed with ui.showForm. */
  shownForm(): { key: string; definition: FormDefinition };
  /** Submits a form with the values a moderator entered. */
  submitForm(key: string, values: Record<string, unknown>): Promise<void>;
  /** Moves the clock forward, running any timers that fall due. */
  advance(ms: number): Promise<void>;
}

/**
 * Settles `work`, advancing fake time only when the app is waiting on a timer (a Slack retry backoff),
 * so delays happen exactly as long as the app asks for.
 */
async function drive<T>(work: Promise<T>): Promise<T> {
  let settled = false;
  work.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  while (!settled) {
    await vi.advanceTimersToNextTimerAsync();
  }
  return work;
}

/**
 * Loads src/main.ts afresh, so each test gets a new bot with no cached settings or moderator list, and
 * wires it to fake Devvit services, a fake Slack webhook and a clock frozen at NOW.
 */
export async function loadApp(devvit: FakeDevvit, settingsOverrides: Settings = {}): Promise<App> {
  vi.useFakeTimers({ now: NOW, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  const settings: Settings = { ...defaultSettings(), ...settingsOverrides };
  const { context, toasts, shownForms } = createFakeContext(settings);
  const slack = new FakeSlack();
  vi.stubGlobal('fetch', slack.fetch);

  devvit.reset();
  vi.resetModules();
  await import('../../src/main');
  const registrations = devvit.registrations;

  return {
    registrations,
    settings,
    context,
    slack,
    toasts,
    async fire(event, payload) {
      const handlers = registrations.triggers.get(event);
      if (!handlers) {
        throw new Error(`no handler registered for ${event}`);
      }
      for (const handler of handlers) {
        await drive(Promise.resolve(handler(payload, context)));
      }
    },
    async runJob(name) {
      const handler = registrations.schedulerJobs.get(name);
      if (!handler) {
        throw new Error(`no scheduler job named ${name}`);
      }
      await drive(Promise.resolve(handler({ name }, context)));
    },
    async pressMenuItem(label) {
      const item = registrations.menuItems.find((menuItem) => menuItem.label === label);
      if (!item) {
        throw new Error(`no menu item labelled ${label}`);
      }
      await drive(Promise.resolve(item.onPress({ location: 'subreddit', targetId: 't5_testsub' }, context)));
    },
    shownForm() {
      const key = shownForms.at(-1);
      const form = key === undefined ? undefined : registrations.forms.get(key);
      if (key === undefined || !form) {
        throw new Error('no form has been shown');
      }
      return { key, definition: form.definition };
    },
    async submitForm(key, values) {
      const form = registrations.forms.get(key);
      if (!form) {
        throw new Error(`no form with key ${key}`);
      }
      await drive(Promise.resolve(form.onSubmit({ values }, context)));
    },
    async advance(ms) {
      await vi.advanceTimersByTimeAsync(ms);
    },
  };
}
