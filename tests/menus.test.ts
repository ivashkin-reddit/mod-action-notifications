import { describe, expect, it, vi } from 'vitest';
import { loadApp, NOW, type App } from './support/app';
import type { SlackMessage } from './support/fakeSlack';

const devvit = await vi.hoisted(async () => (await import('./support/fakeDevvit')).createFakeDevvit());
vi.mock('@devvit/public-api', () => ({ Devvit: devvit.api }));

const JOB_ID_KEY = 'modqueue_monitor_job_id';
const MONITOR_JOB = { id: 'job-1', name: 'modqueueMonitor', cron: '*/15 * * * *' };
const WHEN_NOW = '• *When:* 2026-11-04 12:00:00 UTC';

function lines(message: SlackMessage | undefined): string[] {
  return (message?.attachments?.[0]?.text ?? '').split('\n');
}

/** Opens a menu item's form and submits it with `values`. */
async function submitFrom(app: App, menuItem: string, values: Record<string, unknown>): Promise<void> {
  await app.pressMenuItem(menuItem);
  await app.submitForm(app.shownForm().key, values);
}

describe('installing or upgrading the app', () => {
  it.each([['AppInstall'], ['AppUpgrade']])('%s schedules the modqueue monitor every 15 minutes', async (trigger) => {
    const app = await loadApp(devvit);

    await app.fire(trigger, { type: trigger });

    expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
    expect(await app.context.redis.get(JOB_ID_KEY)).toBe('job-1');
    expect(app.context.redis.ttlSeconds(JOB_ID_KEY)).toBeUndefined();
  });

  it('keeps the job it already scheduled', async () => {
    const app = await loadApp(devvit);

    await app.fire('AppInstall', { type: 'AppInstall' });
    await app.fire('AppUpgrade', { type: 'AppUpgrade' });

    expect(app.context.scheduler.runJob).toHaveBeenCalledTimes(1);
    expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
  });

  it('schedules the monitor when only the age limit is set', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 12 });

    await app.fire('AppInstall', { type: 'AppInstall' });

    expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
  });

  it('cancels the job and forgets it when both monitor thresholds are 0', async () => {
    const app = await loadApp(devvit);
    await app.fire('AppInstall', { type: 'AppInstall' });
    app.settings.modqueueThreshold = 0;
    app.settings.unmoderagedAgeHours = 0;

    await app.fire('AppUpgrade', { type: 'AppUpgrade' });

    expect(app.context.scheduler.cancelJob).toHaveBeenCalledWith('job-1');
    expect(app.context.scheduler.jobs).toStrictEqual([]);
    expect(app.context.redis.keys()).toStrictEqual([]);
  });

  it('forgets the job even when cancelling it fails', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0 });
    app.context.redis.seed(JOB_ID_KEY, 'job-gone');
    app.context.scheduler.cancelJob.mockRejectedValue(new Error('no such job'));

    await app.fire('AppUpgrade', { type: 'AppUpgrade' });

    expect(app.context.redis.keys()).toStrictEqual([]);
  });

  it('schedules nothing when both thresholds are 0 and no job exists', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0 });

    await app.fire('AppInstall', { type: 'AppInstall' });

    expect(app.context.scheduler.runJob).not.toHaveBeenCalled();
    expect(app.context.scheduler.cancelJob).not.toHaveBeenCalled();
  });

  it.each([
    ['AppInstall', 'Failed to auto-setup modqueue monitoring on install:'],
    ['AppUpgrade', 'Failed to setup modqueue monitoring on upgrade:'],
  ])('%s logs a scheduling failure and still succeeds', async (trigger, logMessage) => {
    const app = await loadApp(devvit);
    const error = new Error('scheduler down');
    app.context.scheduler.runJob.mockRejectedValue(error);

    await app.fire(trigger, { type: trigger });

    expect(console.error).toHaveBeenCalledWith('Failed to schedule modqueue monitor job', error);
    expect(console.error).toHaveBeenCalledWith(logMessage, error);
    expect(app.context.redis.keys()).toStrictEqual([]);
  });
});

describe('the Setup Modqueue Monitoring menu item', () => {
  it('schedules the monitor and shows its job ID', async () => {
    const app = await loadApp(devvit);

    await app.pressMenuItem('Setup Modqueue Monitoring');

    expect(app.context.scheduler.jobs).toStrictEqual([MONITOR_JOB]);
    expect(app.toasts).toStrictEqual([{ text: '✅ Modqueue monitoring enabled (Job ID: job-1)', appearance: 'success' }]);
  });

  it('shows the existing job when pressed again', async () => {
    const app = await loadApp(devvit);

    await app.pressMenuItem('Setup Modqueue Monitoring');
    await app.pressMenuItem('Setup Modqueue Monitoring');

    expect(app.context.scheduler.jobs).toHaveLength(1);
    expect(app.toasts.map((toast) => toast.text)).toStrictEqual([
      '✅ Modqueue monitoring enabled (Job ID: job-1)',
      '✅ Modqueue monitoring enabled (Job ID: job-1)',
    ]);
  });

  it('shows an unknown job ID when the scheduler returns none', async () => {
    const app = await loadApp(devvit);
    app.context.scheduler.runJob.mockResolvedValue('');

    await app.pressMenuItem('Setup Modqueue Monitoring');

    expect(app.toasts[0]?.text).toBe('✅ Modqueue monitoring enabled (Job ID: unknown)');
  });

  it('reports monitoring as disabled when both thresholds are 0', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0 });

    await app.pressMenuItem('Setup Modqueue Monitoring');

    expect(app.toasts).toStrictEqual([{ text: '⚠️ Modqueue monitoring disabled (thresholds set to 0)', appearance: 'neutral' }]);
  });

  it('reports a scheduling failure', async () => {
    const app = await loadApp(devvit);
    const error = new Error('scheduler down');
    app.context.scheduler.runJob.mockRejectedValue(error);

    await app.pressMenuItem('Setup Modqueue Monitoring');

    expect(app.toasts).toStrictEqual([{ text: '❌ Failed to setup modqueue monitoring', appearance: 'neutral' }]);
    expect(console.error).toHaveBeenCalledWith('Failed to setup modqueue monitoring:', error);
  });
});

describe('the Show Bot Status menu item', () => {
  async function statusToast(app: App): Promise<string | undefined> {
    await app.pressMenuItem('Show Bot Status');
    expect(app.toasts.at(-1)?.appearance).toBe('neutral');
    return app.toasts.at(-1)?.text;
  }

  it('shows that the monitor is not scheduled yet', async () => {
    const app = await loadApp(devvit);

    expect(await statusToast(app)).toBe('Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Not scheduled');
  });

  it('shows the monitor’s schedule once it is set up', async () => {
    const app = await loadApp(devvit);
    await app.pressMenuItem('Setup Modqueue Monitoring');

    expect(await statusToast(app)).toBe(
      'Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Active (cron */15 * * * *)',
    );
  });

  it('shows an active one-off job without a schedule', async () => {
    const app = await loadApp(devvit);
    app.context.redis.seed(JOB_ID_KEY, 'job-7');
    app.context.scheduler.jobs = [{ id: 'job-7', name: 'modqueueMonitor' }];

    expect(await statusToast(app)).toBe('Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Active');
  });

  it('flags a stored job the scheduler no longer has', async () => {
    const app = await loadApp(devvit);
    app.context.redis.seed(JOB_ID_KEY, 'job-gone');

    expect(await statusToast(app)).toBe('Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Stale reference');
  });

  it('shows the monitor as unknown when the scheduler cannot list jobs', async () => {
    const app = await loadApp(devvit);
    app.context.redis.seed(JOB_ID_KEY, 'job-1');
    app.context.scheduler.listJobs.mockRejectedValue(new Error('scheduler down'));

    expect(await statusToast(app)).toBe('Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Unknown');
  });

  it('shows the job status as unavailable when Redis fails', async () => {
    const app = await loadApp(devvit);
    app.context.redis.get.mockRejectedValue(new Error('redis down'));

    expect(await statusToast(app)).toBe('Modqueue Monitoring: ON • Slack Webhook: Configured • Job Status: Unavailable');
  });

  it('shows monitoring off and the webhook missing', async () => {
    const app = await loadApp(devvit, { slackWebhookUrl: '', modqueueThreshold: 0, unmoderagedAgeHours: 0 });

    expect(await statusToast(app)).toBe('Modqueue Monitoring: OFF • Slack Webhook: Missing • Modqueue Monitor: Not scheduled');
  });

  it('reports a failure to show the status', async () => {
    const app = await loadApp(devvit);
    vi.mocked(app.context.ui.showToast).mockImplementationOnce(() => {
      throw new Error('ui closed');
    });

    await app.pressMenuItem('Show Bot Status');

    expect(app.context.ui.showToast).toHaveBeenLastCalledWith({ text: '❌ Unable to fetch status. Check logs.', appearance: 'neutral' });
    expect(console.error).toHaveBeenCalledWith('Failed to display status summary', new Error('ui closed'));
  });
});

describe('the Test Slack Connection menu item', () => {
  it('opens the test form', async () => {
    const app = await loadApp(devvit);

    await app.pressMenuItem('Test Slack Connection');

    const { definition } = app.shownForm();
    expect(definition.title).toBe('Reddit Mod Action Bot');
    expect(definition.acceptLabel).toBe('Send Test Alert');
    expect(definition.fields.map((field) => field.name)).toStrictEqual(['info']);
  });

  // The test message carries no channel, so it goes to the webhook's own channel whatever the settings say.
  it('sends a test message to the webhook’s own channel and confirms it', async () => {
    const app = await loadApp(devvit, { notificationChannel: 'mod-log' });

    await submitFrom(app, 'Test Slack Connection', {});

    expect(app.slack.messages).toStrictEqual([
      {
        text: '🧪 Test message from Reddit Mod Action Bot',
        username: 'Reddit Mod Bot (Test)',
        icon_emoji: ':robot_face:',
        attachments: [
          {
            color: '#00ff00',
            fields: [
              { title: 'Status', value: 'Bot is working correctly!', short: true },
              { title: 'Timestamp', value: NOW.toISOString(), short: true },
            ],
            footer: 'Reddit Mod Action Bot - Test Message',
          },
        ],
      },
    ]);
    expect(app.toasts).toStrictEqual([{ text: '🧪 Test alert sent! Check your Slack channel and bot logs.', appearance: 'success' }]);
  });

  it('confirms the test even when no webhook is configured', async () => {
    const app = await loadApp(devvit, { slackWebhookUrl: '' });

    await submitFrom(app, 'Test Slack Connection', {});

    expect(app.slack.requests).toStrictEqual([]);
    expect(console.error).toHaveBeenCalledWith('Cannot test: Slack webhook URL not configured');
    expect(app.toasts[0]?.appearance).toBe('success');
  });

  it('confirms the test even when Slack rejects it', async () => {
    const app = await loadApp(devvit);
    app.slack.respond(404);

    await submitFrom(app, 'Test Slack Connection', {});

    expect(app.slack.requests).toHaveLength(1);
    expect(app.toasts[0]?.appearance).toBe('success');
  });

  it('reports a failure to confirm', async () => {
    const app = await loadApp(devvit);
    vi.mocked(app.context.ui.showToast).mockImplementationOnce(() => {
      throw new Error('ui closed');
    });

    await submitFrom(app, 'Test Slack Connection', {});

    expect(app.context.ui.showToast).toHaveBeenLastCalledWith({
      text: '❌ Failed to send test alert. Verify webhook URL in settings.',
      appearance: 'neutral',
    });
  });
});

describe('the Simulate Mod Action menu item', () => {
  it('opens the simulation form', async () => {
    const app = await loadApp(devvit);

    await app.pressMenuItem('Simulate Mod Action');

    const { definition } = app.shownForm();
    expect(definition.title).toBe('Simulate Mod Action');
    expect(definition.fields.map((field) => field.name)).toStrictEqual([
      'actionType', 'moderatorName', 'targetUser', 'includeModNote', 'modNote', 'banDuration', 'customDetails', 'slackChannel',
    ]);
    expect(definition.fields[0]?.options?.map((option) => option.value)).toStrictEqual([
      'removelink', 'removecomment', 'banuser', 'unbanuser', 'muteuser', 'unmuteuser',
    ]);
  });

  it('sends a simulated ban, without checking the mod list or touching stored data', async () => {
    const app = await loadApp(devvit);

    await submitFrom(app, 'Simulate Mod Action', {
      actionType: ['banuser'],
      moderatorName: ' SimMod ',
      targetUser: ' Victim ',
      includeModNote: true,
      modNote: 'Testing',
      banDuration: 7,
      customDetails: '',
      slackChannel: 'mods',
    });

    const [message] = app.slack.messages;
    expect(message?.text).toBe('🔨 User Banned');
    expect(message?.channel).toBe('#mods');
    expect(lines(message)).toStrictEqual([
      '🔔 *Moderator Action*',
      '• *Action:* User Banned',
      '• *Moderator:* <https://www.reddit.com/u/SimMod|u/SimMod>',
      '• *Target:* <https://www.reddit.com/u/Victim|u/Victim>',
      WHEN_NOW,
      '• *Ban Duration:* 7 days',
      '• *Details:* 7 days',
      '• *Mod Note:* Testing',
    ]);
    expect(app.context.reddit.getModerators).not.toHaveBeenCalled();
    expect(app.context.redis.keys()).toStrictEqual([]);
    expect(app.toasts).toStrictEqual([{ text: '✅ Simulation delivered to Slack!', appearance: 'success' }]);
  });

  it('sends a post removal by SimulationMod when the form is left blank', async () => {
    const app = await loadApp(devvit, { notificationChannel: 'mod-log' });

    await submitFrom(app, 'Simulate Mod Action', {});

    const [message] = app.slack.messages;
    expect(message?.text).toBe('🗑️ Post Removed');
    expect(message?.channel).toBe('#mod-log');
    expect(lines(message)).toStrictEqual([
      '🔔 *Moderator Action*',
      '• *Action:* Post Removed',
      '• *Moderator:* <https://www.reddit.com/u/SimulationMod|u/SimulationMod>',
      WHEN_NOW,
    ]);
  });

  it.each([
    [{ includeModNote: true }, '• *Mod Note:* Simulation note'],
    [{ includeModNote: false, modNote: 'Ignored' }, WHEN_NOW],
    [{ customDetails: ' extra ' }, '• *Details:* extra'],
    [{ moderatorName: 'AutoModerator' }, '• *Status:* Origin AutoModerator'],
  ])('ends a simulated removal for %j with %j', async (values, lastLine) => {
    const app = await loadApp(devvit);

    await submitFrom(app, 'Simulate Mod Action', values);

    expect(lines(app.slack.messages[0]).at(-1)).toBe(lastLine);
  });

  it('accepts the action type as text', async () => {
    const app = await loadApp(devvit);

    await submitFrom(app, 'Simulate Mod Action', { actionType: 'unbanuser' });

    expect(app.slack.messages[0]?.text).toBe('🎉 User Unbanned');
  });

  it('keeps a channel that already starts with #', async () => {
    const app = await loadApp(devvit);

    await submitFrom(app, 'Simulate Mod Action', { slackChannel: '#already' });

    expect(app.slack.messages[0]?.channel).toBe('#already');
  });

  it.each([
    [{ banDuration: 1 }, ['• *Ban Duration:* 1 day', '• *Details:* 1 day']],
    [{ banDuration: '0' }, ['• *Ban Duration:* Permanent Ban', '• *Details:* permanent']],
    [{ banDuration: '' }, ['• *Ban Duration:* Permanent Ban', '• *Details:* permanent']],
    [{ banDuration: 'soon' }, ['• *Ban Duration:* Permanent Ban', '• *Details:* permanent']],
    [{ banDuration: -3 }, ['• *Ban Duration:* Unknown Duration']],
    [{ banDuration: -3, customDetails: 'two weeks' }, ['• *Ban Duration:* two weeks', '• *Details:* two weeks']],
    [
      { banDuration: -3, includeModNote: true, modNote: 'banned 5 day' },
      ['• *Ban Duration:* 5 days', '• *Mod Note:* banned 5 day'],
    ],
  ])('describes a simulated ban with %j', async (values, expectedLines) => {
    const app = await loadApp(devvit);

    await submitFrom(app, 'Simulate Mod Action', { actionType: ['banuser'], ...values });

    // Header, action, moderator and time come first; a simulation without a target user has no target line.
    expect(lines(app.slack.messages[0]).slice(4)).toStrictEqual(expectedLines);
  });

  it('reports that it cannot send without a webhook', async () => {
    const app = await loadApp(devvit, { slackWebhookUrl: '' });

    await submitFrom(app, 'Simulate Mod Action', {});

    expect(app.slack.requests).toStrictEqual([]);
    expect(app.toasts).toStrictEqual([{ text: '❌ Could not send simulation. Check logs.', appearance: 'neutral' }]);
    expect(console.error).toHaveBeenCalledWith('Failed to send simulated action', new Error('Slack webhook URL is not configured'));
  });
});
