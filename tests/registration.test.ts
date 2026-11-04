import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadApp } from './support/app';

const devvit = await vi.hoisted(async () => (await import('./support/fakeDevvit')).createFakeDevvit());
vi.mock('@devvit/public-api', () => ({ Devvit: devvit.api }));

interface DevvitJson {
  name: string;
  blocks: { entry: string; triggers: string[] };
  permissions: { http: { enable: boolean; domains: string[] }; redis: boolean; reddit: boolean };
}

function readDevvitJson(): DevvitJson {
  return JSON.parse(readFileSync(new URL('../devvit.json', import.meta.url), 'utf8')) as DevvitJson;
}

describe('what the app registers with Devvit', () => {
  // Setting names are stored per installation: renaming one loses every moderator's saved value.
  it('registers the settings moderators configure, with their names, types and defaults', async () => {
    const app = await loadApp(devvit);

    expect(app.registrations.settings.map(({ name, type, defaultValue }) => ({ name, type, defaultValue }))).toStrictEqual([
      { name: 'slackWebhookUrl', type: 'string', defaultValue: undefined },
      {
        name: 'enabledActions',
        type: 'select',
        defaultValue: ['removelink', 'removecomment', 'spamlink', 'spamcomment', 'banuser', 'unbanuser'],
      },
      { name: 'excludedModerators', type: 'string', defaultValue: undefined },
      { name: 'flagUnknownModerators', type: 'boolean', defaultValue: true },
      { name: 'includeModNote', type: 'boolean', defaultValue: true },
      { name: 'notificationChannel', type: 'string', defaultValue: undefined },
      { name: 'alertChannel', type: 'string', defaultValue: undefined },
      { name: 'modqueueThreshold', type: 'number', defaultValue: 50 },
      { name: 'unmoderagedAgeHours', type: 'number', defaultValue: 24 },
      { name: 'enableAutoModAlerts', type: 'boolean', defaultValue: false },
      { name: 'postDeletionUpvoteThreshold', type: 'number', defaultValue: 100 },
    ]);
  });

  it('offers every mod action type the Slack messages know how to name', async () => {
    const app = await loadApp(devvit);
    const enabledActions = app.registrations.settings.find((setting) => setting.name === 'enabledActions');

    expect(enabledActions?.multiSelect).toBe(true);
    expect(enabledActions?.options?.map((option) => option.value)).toStrictEqual([
      'removelink', 'removecomment', 'spamlink', 'spamcomment', 'approvelink', 'approvecomment', 'banuser',
      'unbanuser', 'lock', 'unlock', 'sticky', 'unsticky', 'editflair', 'muteuser', 'unmuteuser', 'distinguish',
      'ignorereports', 'unignorereports', 'snoozereports', 'unsnoozereports', 'addcontributor', 'removecontributor',
      'invitemoderator', 'uninvitemoderator', 'acceptmoderatorinvite', 'addmoderator', 'removemoderator',
      'editsettings', 'adjust_post_crowd_control_level', 'enable_post_crowd_control_filter',
      'disable_post_crowd_control_filter',
    ]);
  });

  // Devvit 0.15 routes only the triggers devvit.json lists to a Blocks app.
  it('handles exactly the triggers devvit.json subscribes to', async () => {
    const app = await loadApp(devvit);

    const registered = [...app.registrations.triggers.keys()].map((event) => `on${event}`).sort();

    expect(registered).toStrictEqual([...readDevvitJson().blocks.triggers].sort());
    expect(registered).toStrictEqual([
      'onAppInstall', 'onAppUpgrade', 'onModAction', 'onPostCreate', 'onPostDelete', 'onPostUpdate',
    ]);
  });

  // Devvit 0.15 grants a Blocks app only the permissions devvit.json declares, whatever Devvit.configure says.
  it('is granted in devvit.json what it asks for in Devvit.configure', async () => {
    const app = await loadApp(devvit);
    const { permissions, blocks } = readDevvitJson();

    expect(app.registrations.configure).toStrictEqual([
      { redditAPI: true, http: { domains: ['hooks.slack.com'] }, redis: true },
    ]);
    expect(permissions).toStrictEqual({
      http: { enable: true, domains: ['hooks.slack.com'] },
      redis: true,
      reddit: true,
    });
    expect(blocks.entry).toBe('src/main.ts');
  });

  it('registers the modqueue monitor as its only scheduler job', async () => {
    const app = await loadApp(devvit);

    expect([...app.registrations.schedulerJobs.keys()]).toStrictEqual(['modqueueMonitor']);
  });

  it('adds four subreddit menu items, shown to moderators only', async () => {
    const app = await loadApp(devvit);

    expect(app.registrations.menuItems.map(({ label, location, forUserType }) => ({ label, location, forUserType }))).toStrictEqual([
      { label: 'Test Slack Connection', location: 'subreddit', forUserType: 'moderator' },
      { label: 'Show Bot Status', location: 'subreddit', forUserType: 'moderator' },
      { label: 'Simulate Mod Action', location: 'subreddit', forUserType: 'moderator' },
      { label: 'Setup Modqueue Monitoring', location: 'subreddit', forUserType: 'moderator' },
    ]);
  });
});
