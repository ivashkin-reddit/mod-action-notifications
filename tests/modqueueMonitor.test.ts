import { describe, expect, it, vi } from 'vitest';
import { loadApp, NOW, type App } from './support/app';
import type { QueueItem } from './support/fakeContext';

const devvit = await vi.hoisted(async () => (await import('./support/fakeDevvit')).createFakeDevvit());
vi.mock('@devvit/public-api', () => ({ Devvit: devvit.api }));

const HOUR = 60 * 60 * 1000;
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const FAILURE_KEY = 'scheduler_failure_count';

function post(id: string, ageHours: number): QueueItem {
  return { id: `t3_${id}`, title: `Post ${id}`, createdAt: new Date(NOW.getTime() - ageHours * HOUR), permalink: `/r/testsub/comments/${id}/` };
}

function comment(id: string, ageHours: number): QueueItem {
  return { id: `t1_${id}`, createdAt: new Date(NOW.getTime() - ageHours * HOUR), permalink: `/r/testsub/comments/p/c/${id}/` };
}

function freshQueue(size: number): QueueItem[] {
  return Array.from({ length: size }, (_, index) => post(String(index), 0));
}

async function runMonitor(app: App): Promise<void> {
  await app.runJob('modqueueMonitor');
}

describe('the modqueue monitor', () => {
  it('does nothing without a webhook', async () => {
    const app = await loadApp(devvit, { slackWebhookUrl: undefined });

    await runMonitor(app);

    expect(app.context.reddit.getCurrentSubreddit).not.toHaveBeenCalled();
    expect(app.slack.requests).toStrictEqual([]);
  });

  it('alerts when the queue reaches the size threshold', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 3, unmoderagedAgeHours: 0 });
    app.context.reddit.modQueue = [post('a', 1), post('b', 1), comment('c', 1)];

    await runMonitor(app);

    expect(app.context.reddit.getModQueue).toHaveBeenCalledWith({ type: 'all' });
    expect(app.slack.messages).toStrictEqual([
      {
        text: '⚠️ Modqueue Alert: 3 items pending',
        username: 'Reddit Mod Bot',
        icon_emoji: ':warning:',
        attachments: [
          {
            color: '#ff9900',
            fields: [
              { title: '📋 Queue Size', value: '3', short: true },
              { title: '📝 Posts', value: '2', short: true },
              { title: '💬 Comments', value: '1', short: true },
              { title: '🎯 Threshold', value: '3', short: true },
            ],
            footer: 'Reddit Mod Action Bot - Modqueue Monitor',
            ts: NOW_SECONDS,
          },
        ],
      },
    ]);
  });

  it('stays quiet below the size threshold', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 3 });
    app.context.reddit.modQueue = freshQueue(2);

    await runMonitor(app);

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('sends the size alert at most once an hour', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 1 });
    app.context.reddit.modQueue = freshQueue(1);

    await runMonitor(app);
    await app.advance(HOUR - 1);
    await runMonitor(app);
    expect(app.slack.requests).toHaveLength(1);
    expect(app.context.redis.keys()).toContain('mod_actions:throttle:modqueue_size');

    await app.advance(1);
    await runMonitor(app);
    expect(app.slack.requests).toHaveLength(2);
  });

  it('never alerts on size when the size threshold is 0', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 0 });
    app.context.reddit.modQueue = freshQueue(500);

    await runMonitor(app);

    expect(app.slack.requests).toStrictEqual([]);
  });

  it.each([
    ['3', '3'],
    [3.9, '3'],
    ['not a number', '50'],
    [null, '50'],
  ])('reads a size threshold setting of %j as %s', async (threshold, expected) => {
    const app = await loadApp(devvit, { modqueueThreshold: threshold, unmoderagedAgeHours: 0 });
    app.context.reddit.modQueue = freshQueue(60);

    await runMonitor(app);

    expect(app.slack.messages[0]?.attachments?.[0]?.fields?.at(-1)).toStrictEqual({ title: '🎯 Threshold', value: expected, short: true });
  });

  it('treats a negative size threshold as 0', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: -4, unmoderagedAgeHours: 0 });
    app.context.reddit.modQueue = freshQueue(60);

    await runMonitor(app);

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('lists the five oldest items waiting longer than the age limit', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 24 });
    app.context.reddit.modQueue = [
      post('a', 30),
      comment('b', 25),
      post('c', 2),
      post('d', 48),
      comment('e', 24),
      post('f', 26),
      post('g', 27),
    ];

    await runMonitor(app);

    expect(app.slack.messages).toStrictEqual([
      {
        text: '⏰ Unmoderated Content Alert: 6 items over 24h old',
        username: 'Reddit Mod Bot',
        icon_emoji: ':alarm_clock:',
        attachments: [
          {
            color: '#ff6600',
            fields: [
              {
                title: '📌 Oldest Items (showing 5 of 6)',
                value: [
                  '• Post (48h old): https://reddit.com/r/testsub/comments/d/',
                  '• Post (30h old): https://reddit.com/r/testsub/comments/a/',
                  '• Post (27h old): https://reddit.com/r/testsub/comments/g/',
                  '• Post (26h old): https://reddit.com/r/testsub/comments/f/',
                  '• Comment (25h old): https://reddit.com/r/testsub/comments/p/c/b/',
                ].join('\n'),
                short: false,
              },
            ],
            footer: 'Reddit Mod Action Bot - Unmoderated Monitor',
            ts: NOW_SECONDS,
          },
        ],
      },
    ]);
  });

  it('stays quiet when nothing has waited as long as the age limit', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 24 });
    app.context.reddit.modQueue = [post('a', 23), comment('b', 1)];

    await runMonitor(app);

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('skips the age check when the age limit is 0', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 0, unmoderagedAgeHours: 0 });
    app.context.reddit.modQueue = [post('a', 1000)];

    await runMonitor(app);

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('throttles the size and age alerts separately, each to once an hour', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 1, unmoderagedAgeHours: 1 });
    app.context.reddit.modQueue = [post('a', 5)];

    await runMonitor(app);
    await runMonitor(app);

    expect(app.slack.messages.map((message) => message.text)).toStrictEqual([
      '⚠️ Modqueue Alert: 1 items pending',
      '⏰ Unmoderated Content Alert: 1 items over 1h old',
    ]);
    expect(app.context.redis.keys()).toStrictEqual(['mod_actions:throttle:modqueue_size', 'mod_actions:throttle:modqueue_unmoderated']);
    expect(app.context.redis.ttlSeconds('mod_actions:throttle:modqueue_unmoderated')).toBe(3600);
  });

  it('sends both alerts to the alert channel', async () => {
    const app = await loadApp(devvit, { modqueueThreshold: 1, unmoderagedAgeHours: 1, alertChannel: '#alerts' });
    app.context.reddit.modQueue = [post('a', 5)];

    await runMonitor(app);

    expect(app.slack.messages.map((message) => message.channel)).toStrictEqual(['#alerts', '#alerts']);
  });

  it('clears the failure count after a successful run', async () => {
    const app = await loadApp(devvit);
    app.context.redis.seed(FAILURE_KEY, '2');

    await runMonitor(app);

    expect(app.context.redis.keys()).not.toContain(FAILURE_KEY);
  });

  it('still succeeds when clearing the failure count fails', async () => {
    const app = await loadApp(devvit);
    app.context.redis.del.mockRejectedValue(new Error('redis down'));

    await expect(runMonitor(app)).resolves.toBeUndefined();
  });
});

describe('a failing modqueue monitor run', () => {
  it('fails the job, logs the error and counts the failure for an hour', async () => {
    const app = await loadApp(devvit);
    const error = new Error('reddit 503');
    app.context.reddit.getModQueue.mockRejectedValue(error);

    await expect(runMonitor(app)).rejects.toThrow(error);

    expect(console.error).toHaveBeenCalledWith('Failed to check modqueue:', error);
    expect(await app.context.redis.get(FAILURE_KEY)).toBe('1');
    expect(app.context.redis.ttlSeconds(FAILURE_KEY)).toBe(3600);
    expect(app.slack.requests).toStrictEqual([]);
  });

  it('alerts Slack on the third failure in a row, then counts again from zero', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.getModQueue.mockRejectedValue(new Error('reddit 503'));

    for (let run = 0; run < 6; run++) {
      await expect(runMonitor(app)).rejects.toThrow('reddit 503');
    }

    const alert = {
      text: '⚠️ Critical: Modqueue Monitoring Failed 3 Times',
      username: 'Reddit Mod Bot',
      icon_emoji: ':warning:',
      attachments: [
        {
          color: '#ff0000',
          fields: [
            { title: '❌ Status', value: 'Scheduler job has failed repeatedly', short: true },
            { title: '🔢 Failure Count', value: '3', short: true },
            { title: '🔍 Error', value: 'reddit 503', short: false },
            { title: '⚙️ Action Required', value: 'Check bot configuration and permissions', short: false },
          ],
          footer: 'Reddit Mod Action Bot - Scheduler Monitor',
          ts: NOW_SECONDS,
        },
      ],
    };
    expect(app.slack.messages).toStrictEqual([alert, alert]);
    expect(app.context.redis.keys()).not.toContain(FAILURE_KEY);
  });

  it('sends the failure alert to the alert channel, naming an error without a message as unknown', async () => {
    const app = await loadApp(devvit, { alertChannel: 'alerts' });
    app.context.reddit.getModQueue.mockRejectedValue(new Error(''));

    for (let run = 0; run < 3; run++) {
      await expect(runMonitor(app)).rejects.toThrow();
    }

    const [message] = app.slack.messages;
    expect(message?.channel).toBe('#alerts');
    expect(message?.attachments?.[0]?.fields?.[2]).toStrictEqual({ title: '🔍 Error', value: 'Unknown error', short: false });
  });

  it('forgets failures an hour after the last one', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.getModQueue.mockRejectedValue(new Error('reddit 503'));

    await expect(runMonitor(app)).rejects.toThrow();
    await app.advance(HOUR);
    await expect(runMonitor(app)).rejects.toThrow();
    await expect(runMonitor(app)).rejects.toThrow();

    expect(app.slack.requests).toStrictEqual([]);
    expect(await app.context.redis.get(FAILURE_KEY)).toBe('2');
  });

  it('counts afresh after a successful run', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.getModQueue.mockRejectedValueOnce(new Error('one')).mockRejectedValueOnce(new Error('two'));

    await expect(runMonitor(app)).rejects.toThrow();
    await expect(runMonitor(app)).rejects.toThrow();
    await runMonitor(app);
    app.context.reddit.getModQueue.mockRejectedValueOnce(new Error('three'));
    await expect(runMonitor(app)).rejects.toThrow();

    expect(app.slack.requests).toStrictEqual([]);
    expect(await app.context.redis.get(FAILURE_KEY)).toBe('1');
  });

  it('does not count a failure that is not an Error', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.getModQueue.mockRejectedValue('reddit said no');

    await expect(runMonitor(app)).rejects.toBe('reddit said no');

    expect(app.context.redis.keys()).toStrictEqual([]);
  });

  it('does not count a failure to look up the subreddit', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.getCurrentSubreddit.mockRejectedValue(new Error('reddit down'));

    await expect(runMonitor(app)).rejects.toThrow('reddit down');

    expect(app.context.redis.keys()).toStrictEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it('still fails the job with the original error when counting the failure fails', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.getModQueue.mockRejectedValue(new Error('reddit 503'));
    app.context.redis.incrBy.mockRejectedValue(new Error('redis down'));

    await expect(runMonitor(app)).rejects.toThrow('reddit 503');

    expect(console.error).toHaveBeenCalledWith('Failed to track scheduler failures');
  });
});
