/**
 * The app's entry point and composition root: everything it registers with Devvit (settings, triggers, the
 * scheduler job, forms and menu items) and what moderators see from menus. composition.ts builds what each
 * handler needs; the capability modules do the work.
 */
import { Devvit } from '@devvit/public-api';
import {
  alertOnModAction,
  alertOnPostDeletion,
  botStatus,
  rememberPost,
  runModqueueMonitor,
  sendSimulatedModAction,
  setUpModqueueMonitor,
  testSlackConnection,
  type BotStatus,
} from './composition';
import { simulateForm } from './moderation';
import { MONITOR_JOB_NAME, type MonitorJobStatus } from './modqueue';
import { settingsDefinitions } from './settings';

// devvit.json grants these permissions; Devvit 0.15 takes them from there, not from here.
Devvit.configure({
  redditAPI: true,
  http: {
    domains: ['hooks.slack.com'],
  },
  redis: true,
});

Devvit.addSettings(settingsDefinitions);

// Triggers. devvit.json must list every trigger registered here.

Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_event, context) => {
    try {
      await setUpModqueueMonitor(context);
    } catch (error) {
      console.error('Failed to auto-setup modqueue monitoring on install:', error);
    }
  },
});

Devvit.addTrigger({
  event: 'AppUpgrade',
  onEvent: async (_event, context) => {
    try {
      await setUpModqueueMonitor(context);
    } catch (error) {
      console.error('Failed to setup modqueue monitoring on upgrade:', error);
    }
  },
});

Devvit.addTrigger({
  event: 'ModAction',
  onEvent: (event, context) => alertOnModAction(event, context),
});

Devvit.addTrigger({
  event: 'PostDelete',
  onEvent: async (event, context) => {
    try {
      await alertOnPostDeletion(event as unknown as Record<string, unknown>, context);
    } catch (error) {
      console.error('Failed to handle post delete:', error);
    }
  },
});

Devvit.addTrigger({
  event: 'PostCreate',
  onEvent: async (event, context) => {
    try {
      await rememberPost(event as unknown as Record<string, unknown>, context);
    } catch {
      // A post that cannot be remembered only means no alert if it is deleted.
    }
  },
});

Devvit.addTrigger({
  event: 'PostUpdate',
  onEvent: async (event, context) => {
    try {
      await rememberPost(event as unknown as Record<string, unknown>, context);
    } catch {
      // A post that cannot be remembered only means no alert if it is deleted.
    }
  },
});

// The modqueue monitor. A failing run rejects, so the scheduler records it.
Devvit.addSchedulerJob({
  name: MONITOR_JOB_NAME,
  onRun: async (_event, context) => {
    await runModqueueMonitor(context);
  },
});

// Forms and menu items, for moderators only.

const testForm = Devvit.createForm(
  {
    title: 'Reddit Mod Action Bot',
    description: 'Test your bot configuration and send a test alert to Slack',
    fields: [
      {
        name: 'info',
        label: 'Bot Status',
        type: 'paragraph',
        defaultValue:
          'This bot monitors moderator actions and sends notifications to Slack. Click "Send Test Alert" to verify your webhook configuration.',
        disabled: true,
      },
    ],
    acceptLabel: 'Send Test Alert',
    cancelLabel: 'Close',
  },
  async (_values, context) => {
    try {
      await testSlackConnection(context);
      context.ui.showToast({
        text: '🧪 Test alert sent! Check your Slack channel and bot logs.',
        appearance: 'success',
      });
    } catch (error) {
      console.error('Error sending test alert - check webhook URL and Slack permissions:', error);
      context.ui.showToast({
        text: '❌ Failed to send test alert. Verify webhook URL in settings.',
        appearance: 'neutral',
      });
    }
  },
);

const simulateActionForm = Devvit.createForm(simulateForm, async ({ values }, context) => {
  try {
    await sendSimulatedModAction(values as Record<string, unknown>, context);
    context.ui.showToast({
      text: '✅ Simulation delivered to Slack!',
      appearance: 'success',
    });
  } catch (error) {
    console.error('Failed to send simulated action', error);
    context.ui.showToast({
      text: '❌ Could not send simulation. Check logs.',
      appearance: 'neutral',
    });
  }
});

Devvit.addMenuItem({
  label: 'Test Slack Connection',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    context.ui.showForm(testForm);
  },
});

Devvit.addMenuItem({
  label: 'Show Bot Status',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    try {
      context.ui.showToast({
        text: describeStatus(await botStatus(context)),
        appearance: 'neutral',
      });
    } catch (error) {
      console.error('Failed to display status summary', error);
      context.ui.showToast({
        text: '❌ Unable to fetch status. Check logs.',
        appearance: 'neutral',
      });
    }
  },
});

Devvit.addMenuItem({
  label: 'Simulate Mod Action',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    context.ui.showForm(simulateActionForm);
  },
});

Devvit.addMenuItem({
  label: 'Setup Modqueue Monitoring',
  location: 'subreddit',
  forUserType: 'moderator',
  onPress: async (_event, context) => {
    try {
      const result = await setUpModqueueMonitor(context);
      if (result.enabled) {
        context.ui.showToast({
          text: `✅ Modqueue monitoring enabled (Job ID: ${result.jobId || 'unknown'})`,
          appearance: 'success',
        });
      } else {
        context.ui.showToast({
          text: '⚠️ Modqueue monitoring disabled (thresholds set to 0)',
          appearance: 'neutral',
        });
      }
    } catch (error) {
      console.error('Failed to setup modqueue monitoring:', error);
      context.ui.showToast({
        text: '❌ Failed to setup modqueue monitoring',
        appearance: 'neutral',
      });
    }
  },
});

function describeStatus({ monitoringEnabled, webhookConfigured, monitorJob }: BotStatus): string {
  return [
    `Modqueue Monitoring: ${monitoringEnabled ? 'ON' : 'OFF'}`,
    `Slack Webhook: ${webhookConfigured ? 'Configured' : 'Missing'}`,
    describeMonitorJob(monitorJob),
  ].join(' • ');
}

function describeMonitorJob(status: MonitorJobStatus): string {
  switch (status.state) {
    case 'not-scheduled':
      return 'Modqueue Monitor: Not scheduled';
    case 'active':
      return status.cron ? `Modqueue Monitor: Active (cron ${status.cron})` : 'Modqueue Monitor: Active';
    case 'stale':
      return 'Modqueue Monitor: Stale reference';
    case 'unknown':
      return 'Modqueue Monitor: Unknown';
    case 'unavailable':
      return 'Job Status: Unavailable';
  }
}

export default Devvit;
