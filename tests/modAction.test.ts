import { describe, expect, it, vi } from 'vitest';
import { loadApp, NOW, type App } from './support/app';
import { modActionEvent } from './support/events';
import { WEBHOOK_URL } from './support/fakeContext';
import type { SlackMessage } from './support/fakeSlack';

const devvit = await vi.hoisted(async () => (await import('./support/fakeDevvit')).createFakeDevvit());
vi.mock('@devvit/public-api', () => ({ Devvit: devvit.api }));

const NOW_SECONDS = Math.floor(NOW.getTime() / 1000);
const WHEN_NOW = '• *When:* 2026-11-04 12:00:00 UTC';
const MINUTE = 60_000;

function onlyMessage(app: App): SlackMessage {
  expect(app.slack.messages).toHaveLength(1);
  return app.slack.messages[0];
}

/** The lines of a message's attachment text. */
function lines(message: SlackMessage): string[] {
  return (message.attachments?.[0]?.text ?? '').split('\n');
}

function removedPost(fields: Parameters<typeof modActionEvent>[0] = {}) {
  return modActionEvent({
    action: 'removelink',
    moderator: { name: 'ModA' },
    targetUser: { name: 'Author' },
    targetPost: {
      id: 't3_abc',
      title: 'Hello world',
      permalink: '/r/testsub/comments/abc/hello_world/',
      authorId: 't2_author',
    },
    ...fields,
  });
}

function bannedUser(fields: Parameters<typeof modActionEvent>[0] = {}) {
  return modActionEvent({ action: 'banuser', moderator: { name: 'ModA' }, targetUser: { name: 'Troll' }, ...fields });
}

describe('a mod action', () => {
  it('is posted to the Slack webhook as a formatted message', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost());

    expect(app.slack.requests).toHaveLength(1);
    const [request] = app.slack.requests;
    expect(request.url).toBe(WEBHOOK_URL);
    expect(request.method).toBe('POST');
    expect(request.headers).toStrictEqual({ 'Content-Type': 'application/json' });
    expect(request.message).toStrictEqual({
      text: '🗑️ Post Removed',
      username: 'Reddit Mod Bot',
      icon_emoji: ':shield:',
      attachments: [
        {
          color: '#ff4444',
          text: [
            '🔔 *Moderator Action*',
            '• *Action:* Post Removed',
            '• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>',
            '• *Target:* <https://www.reddit.com/u/Author|u/Author>',
            '• *Content:* <https://www.reddit.com/r/testsub/comments/abc/hello_world/|View Post>',
            '> Hello world',
            WHEN_NOW,
          ].join('\n'),
          mrkdwn_in: ['text', 'fields'],
          footer: 'Reddit Mod Action Bot',
          ts: NOW_SECONDS,
        },
      ],
    });
  });

  // Devvit's ModAction event carries the action time in `actionedAt`, which the app does not read.
  it('is timed by when the trigger runs, not by the event’s actionedAt', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost({ actionedAt: new Date('2026-11-04T11:00:00Z') }));

    const message = onlyMessage(app);
    expect(lines(message)).toContain(WHEN_NOW);
    expect(message.attachments?.[0]?.ts).toBe(NOW_SECONDS);
  });

  it('names a comment action and links to the comment', async () => {
    const app = await loadApp(devvit);

    await app.fire(
      'ModAction',
      modActionEvent({
        action: 'removecomment',
        moderator: { name: 'ModA' },
        targetUser: { name: 'Commenter' },
        targetComment: { id: 't1_c', body: 'Rude comment', permalink: '/r/testsub/comments/abc/x/c/', author: 't2_c' },
      }),
    );

    const message = onlyMessage(app);
    expect(message.text).toBe('🗑️ Comment Removed');
    expect(lines(message)).toStrictEqual([
      '🔔 *Moderator Action*',
      '• *Action:* Comment Removed',
      '• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>',
      '• *Target:* <https://www.reddit.com/u/Commenter|u/Commenter>',
      '• *Content:* <https://www.reddit.com/r/testsub/comments/abc/x/c/|View Comment>',
      '> Rude comment',
      WHEN_NOW,
    ]);
  });

  it.each([
    ['lock', '🔒 Comment Locked', 'Comment Locked'],
    ['unlock', '🔓 Comment Unlocked', 'Comment Unlocked'],
  ])('names %s on a comment as a comment action', async (action, title, plain) => {
    const app = await loadApp(devvit, { enabledActions: [action] });

    await app.fire(
      'ModAction',
      modActionEvent({ action, moderator: { name: 'ModA' }, targetComment: { id: 't1_c', body: 'text', author: 't2_c' } }),
    );

    const message = onlyMessage(app);
    expect(message.text).toBe(title);
    expect(lines(message)[1]).toBe(`• *Action:* ${plain}`);
  });

  it.each([
    ['removelink', '🗑️ Post Removed', 'Post Removed', '#ff4444'],
    ['removecomment', '🗑️ Comment Removed', 'Comment Removed', '#ff4444'],
    ['spamlink', '🚫 Post Marked as Spam', 'Post Marked as Spam', '#ff0088'],
    ['spamcomment', '🚫 Comment Marked as Spam', 'Comment Marked as Spam', '#ff0088'],
    ['banuser', '🔨 User Banned', 'User Banned', '#cc0000'],
    ['unbanuser', '🎉 User Unbanned', 'User Unbanned', '#00cc00'],
    ['lock', '🔒 Post Locked', 'Post Locked', '#ff8800'],
    ['unlock', '🔓 Post Unlocked', 'Post Unlocked', '#00cc00'],
    ['sticky', '📌 Post Stickied', 'Post Stickied', '#0088ff'],
    ['unsticky', '📌 Post Unstickied', 'Post Unstickied', '#888888'],
    ['approvelink', '✅ Post Approved', 'Post Approved', '#00cc00'],
    ['approvecomment', '✅ Comment Approved', 'Comment Approved', '#00cc00'],
    ['editflair', '🏷️ Flair Edited', 'Flair Edited', '#8800ff'],
    ['muteuser', '🔇 User Muted', 'User Muted', '#ff8800'],
    ['unmuteuser', '🔊 User Unmuted', 'User Unmuted', '#00cc00'],
    ['distinguish', '⭐ Distinguished', 'Distinguished', '#0088ff'],
    ['ignorereports', '🔕 Reports Ignored', 'Reports Ignored', '#888888'],
    ['unignorereports', '🔔 Reports Unignored', 'Reports Unignored', '#00cc00'],
    ['snoozereports', '⏰ Reports Snoozed', 'Reports Snoozed', '#ff8800'],
    ['unsnoozereports', '⏰ Reports Unsnoozed', 'Reports Unsnoozed', '#00cc00'],
    ['addcontributor', '✅ Approved User Added', 'Approved User Added', '#00cc00'],
    ['removecontributor', '❌ Approved User Removed', 'Approved User Removed', '#ff4444'],
    ['invitemoderator', '📨 Moderator Invited', 'Moderator Invited', '#0088ff'],
    ['uninvitemoderator', '📭 Moderator Uninvited', 'Moderator Uninvited', '#ff8800'],
    ['acceptmoderatorinvite', '✅ Moderator Invite Accepted', 'Moderator Invite Accepted', '#00cc00'],
    ['addmoderator', '👤 Moderator Added', 'Moderator Added', '#0088ff'],
    ['removemoderator', '👤 Moderator Removed', 'Moderator Removed', '#ff4444'],
    ['editsettings', '⚙️ Settings Edited', 'Settings Edited', '#8800ff'],
    ['adjust_post_crowd_control_level', '👥 Crowd Control Adjusted', 'Crowd Control Adjusted', '#ff8800'],
    ['enable_post_crowd_control_filter', '🛡️ Crowd Control Enabled', 'Crowd Control Enabled', '#ff8800'],
    ['disable_post_crowd_control_filter', '🛡️ Crowd Control Disabled', 'Crowd Control Disabled', '#00cc00'],
    ['wikirevise', 'wikirevise', 'wikirevise', '#666666'],
  ])('names %s "%s" and colours it %s', async (action, title, plain, color) => {
    const app = await loadApp(devvit, { enabledActions: [action] });

    await app.fire('ModAction', removedPost({ action }));

    const message = onlyMessage(app);
    expect(message.text).toBe(title);
    expect(message.attachments?.[0]?.color).toBe(color);
    expect(lines(message)[1]).toBe(`• *Action:* ${plain}`);
  });

  it('quotes the post body rather than its title when it has one', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost({ targetPost: { id: 't3_abc', title: 'Title', selftext: 'Body text' } }));

    expect(lines(onlyMessage(app))).toContain('> Body text');
  });

  it('quotes at most 200 characters of the content', async () => {
    const app = await loadApp(devvit);

    await app.fire(
      'ModAction',
      modActionEvent({
        action: 'removecomment',
        moderator: { name: 'ModA' },
        targetComment: { id: 't1_c', body: 'x'.repeat(250), author: 't2_c' },
      }),
    );

    expect(lines(onlyMessage(app))).toContain(`> ${'x'.repeat(200)}...`);
  });

  it('quotes content of exactly 200 characters in full', async () => {
    const app = await loadApp(devvit);

    await app.fire(
      'ModAction',
      modActionEvent({
        action: 'removecomment',
        moderator: { name: 'ModA' },
        targetComment: { id: 't1_c', body: 'y'.repeat(200), author: 't2_c' },
      }),
    );

    expect(lines(onlyMessage(app))).toContain(`> ${'y'.repeat(200)}`);
  });

  it('leaves out the quote and the content link when the content is blank', async () => {
    const app = await loadApp(devvit);

    await app.fire(
      'ModAction',
      modActionEvent({
        action: 'removecomment',
        moderator: { name: 'ModA' },
        targetComment: { id: 't1_c', body: '   ', author: 'Commenter' },
      }),
    );

    expect(lines(onlyMessage(app))).toStrictEqual([
      '🔔 *Moderator Action*',
      '• *Action:* Comment Removed',
      '• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>',
      '• *Target:* <https://www.reddit.com/u/Commenter|u/Commenter>',
      WHEN_NOW,
    ]);
  });

  it('keeps an absolute permalink as it is', async () => {
    const app = await loadApp(devvit);

    await app.fire(
      'ModAction',
      removedPost({ targetPost: { id: 't3_abc', title: 'T', permalink: 'https://old.reddit.com/r/testsub/comments/abc/' } }),
    );

    expect(lines(onlyMessage(app))).toContain('• *Content:* <https://old.reddit.com/r/testsub/comments/abc/|View Post>');
  });

  it('names the post author by ID when the event has no target user', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost({ targetUser: undefined }));

    expect(lines(onlyMessage(app))).toContain('• *Target:* <https://www.reddit.com/u/t2_author|u/t2_author>');
  });

  it('strips a u/ prefix from usernames and URL-encodes the link', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost({ targetUser: { name: 'U/Zoë' } }));

    expect(lines(onlyMessage(app))).toContain('• *Target:* <https://www.reddit.com/u/Zo%C3%AB|u/Zoë>');
  });

  it('shows the moderator as Unknown when the event names none, without checking the mod list', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost({ moderator: undefined }));

    expect(lines(onlyMessage(app))[2]).toBe('• *Moderator:* Unknown');
    expect(app.context.reddit.getModerators).not.toHaveBeenCalled();
  });

  it('shows a blank moderator name as Unknown', async () => {
    const app = await loadApp(devvit, { flagUnknownModerators: false });

    await app.fire('ModAction', removedPost({ moderator: { name: '   ' } }));

    expect(lines(onlyMessage(app))[2]).toBe('• *Moderator:* Unknown');
  });

  it('is sent to the notification channel, with any leading #s normalised to one', async () => {
    const app = await loadApp(devvit, { notificationChannel: ' ##mod-log ' });

    await app.fire('ModAction', removedPost());

    expect(onlyMessage(app).channel).toBe('#mod-log');
  });

  it('goes to the webhook’s default channel when the channel setting is not text', async () => {
    const app = await loadApp(devvit, { notificationChannel: 42 });

    await app.fire('ModAction', removedPost());

    expect(onlyMessage(app)).not.toHaveProperty('channel');
  });
});

describe('which mod actions are sent', () => {
  it('sends nothing when no webhook is configured', async () => {
    const app = await loadApp(devvit, { slackWebhookUrl: undefined });

    await app.fire('ModAction', removedPost());

    expect(app.slack.requests).toStrictEqual([]);
    expect(console.error).toHaveBeenCalledWith('Slack webhook URL not configured - skipping notification');
  });

  it('refuses a webhook URL that is not https', async () => {
    const app = await loadApp(devvit, { slackWebhookUrl: 'http://hooks.slack.com/services/T000/B000/XXXX' });

    await app.fire('ModAction', removedPost());

    expect(app.slack.requests).toStrictEqual([]);
    expect(console.error).toHaveBeenCalledWith('Invalid Slack webhook URL: must start with https://');
  });

  it('trims spaces around the webhook URL', async () => {
    const app = await loadApp(devvit, { slackWebhookUrl: `  ${WEBHOOK_URL}  ` });

    await app.fire('ModAction', removedPost());

    expect(app.slack.requests[0]?.url).toBe(WEBHOOK_URL);
  });

  it('sends nothing for an action type that is not enabled', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost({ action: 'lock' }));

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('treats an enabled-actions setting that is not a list as nothing enabled', async () => {
    const app = await loadApp(devvit, { enabledActions: 'removelink' });

    await app.fire('ModAction', removedPost());

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('skips excluded moderators, matching the comma-separated names case-insensitively', async () => {
    const app = await loadApp(devvit, { excludedModerators: ' moda , SomeBot ,, ' });

    await app.fire('ModAction', removedPost());
    await app.fire('ModAction', removedPost({ moderator: { name: 'ModB' } }));

    expect(lines(onlyMessage(app))[2]).toBe('• *Moderator:* <https://www.reddit.com/u/ModB|u/ModB>');
  });

  it('sends nothing when the settings cannot be read', async () => {
    const app = await loadApp(devvit);
    vi.mocked(app.context.settings.get).mockRejectedValue(new Error('settings unavailable'));

    await app.fire('ModAction', removedPost());

    expect(app.slack.requests).toStrictEqual([]);
    expect(console.error).toHaveBeenCalledWith(
      'Failed to load configuration - check settings format and values:',
      new Error('settings unavailable'),
    );
  });
});

describe('an action by someone not on the mod list', () => {
  it('is sent as a security alert to the alert channel', async () => {
    const app = await loadApp(devvit, { alertChannel: 'security', notificationChannel: 'mod-log' });

    await app.fire('ModAction', removedPost({ moderator: { name: 'Intruder' } }));

    const message = onlyMessage(app);
    expect(message.text).toBe('🚨 SECURITY ALERT: 🗑️ Post Removed by unknown moderator');
    expect(message.icon_emoji).toBe(':warning:');
    expect(message.channel).toBe('#security');
    expect(message.attachments?.[0]?.color).toBe('#ff0000');
    expect(lines(message)[0]).toBe('🚨 *Security Alert*');
    expect(lines(message).at(-1)).toBe('• *Status:* Unknown moderator (alert)');
    expect(console.warn).toHaveBeenCalledWith('Mod action by unknown moderator', {
      moderator: 'Intruder',
      action: 'removelink',
    });
  });

  it('goes to the notification channel when no alert channel is set', async () => {
    const app = await loadApp(devvit, { notificationChannel: 'mod-log' });

    await app.fire('ModAction', removedPost({ moderator: { name: 'Intruder' } }));

    expect(onlyMessage(app).channel).toBe('#mod-log');
  });

  it('is not flagged when the moderator’s name differs only in case', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost({ moderator: { name: 'moda' } }));

    expect(onlyMessage(app).text).toBe('🗑️ Post Removed');
  });

  it('is sent as a normal message when flagging unknown moderators is off', async () => {
    const app = await loadApp(devvit, { flagUnknownModerators: false });

    await app.fire('ModAction', removedPost({ moderator: { name: 'Intruder' } }));

    expect(onlyMessage(app).text).toBe('🗑️ Post Removed');
    expect(app.context.reddit.getModerators).not.toHaveBeenCalled();
  });

  it('is treated as by a moderator when the mod list cannot be fetched', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.getModerators.mockRejectedValue(new Error('reddit down'));

    await app.fire('ModAction', removedPost({ moderator: { name: 'Intruder' } }));

    expect(onlyMessage(app).text).toBe('🗑️ Post Removed');
    expect(console.error).toHaveBeenCalledWith('Failed to fetch moderator list:', new Error('reddit down'));
  });
});

describe('the mod list', () => {
  it('is fetched once and reused for five minutes', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost());
    await app.advance(5 * MINUTE - 1);
    await app.fire('ModAction', removedPost());
    expect(app.context.reddit.getModerators).toHaveBeenCalledTimes(1);

    await app.advance(1);
    await app.fire('ModAction', removedPost());
    expect(app.context.reddit.getModerators).toHaveBeenCalledTimes(2);
  });
});

describe('AutoModerator actions', () => {
  it('are not sent by default', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.moderators = ['ModA', 'AutoModerator'];

    await app.fire('ModAction', removedPost({ moderator: { name: 'AutoModerator' } }));

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('are sent, marked as from AutoModerator, when AutoModerator alerts are on', async () => {
    const app = await loadApp(devvit, { enableAutoModAlerts: true });
    app.context.reddit.moderators = ['ModA', 'AutoModerator'];

    await app.fire('ModAction', removedPost({ moderator: { name: 'AutoModerator' } }));

    expect(lines(onlyMessage(app)).at(-1)).toBe('• *Status:* Origin AutoModerator');
  });

  it('do not count toward a moderator activity spike', async () => {
    const app = await loadApp(devvit, { enableAutoModAlerts: true });
    app.context.reddit.moderators = ['ModA', 'AutoModerator'];

    for (let i = 0; i < 6; i++) {
      await app.fire('ModAction', removedPost({ moderator: { name: 'AutoModerator' } }));
    }

    expect(app.slack.messages.map((message) => lines(message).at(-1))).toStrictEqual(
      Array<string>(6).fill('• *Status:* Origin AutoModerator'),
    );
    expect(app.context.redis.keys()).toStrictEqual([]);
  });
});

describe('an activity spike', () => {
  it('is flagged on a moderator’s fifth action within a minute', async () => {
    const app = await loadApp(devvit);

    for (let i = 0; i < 5; i++) {
      await app.fire('ModAction', removedPost());
      await app.advance(10_000);
    }

    const statusLines = app.slack.messages.map((message) => lines(message).find((line) => line.startsWith('• *Status:*')));
    expect(statusLines).toStrictEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      '• *Status:* Activity spike 5 actions / 1 min',
    ]);
  });

  it('keeps each moderator’s recent actions in Redis for an hour', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost());

    const key = 'mod_actions:moderator_activity:testsub:moda';
    expect(app.context.redis.keys()).toStrictEqual([key]);
    expect(JSON.parse(String(await app.context.redis.get(key)))).toStrictEqual([NOW.getTime()]);
    expect(app.context.redis.ttlSeconds(key)).toBe(3600);
  });

  it('counts an action exactly a minute old but not one older', async () => {
    const app = await loadApp(devvit);

    for (let i = 0; i < 4; i++) {
      await app.fire('ModAction', removedPost());
    }
    await app.advance(MINUTE);
    await app.fire('ModAction', removedPost());
    await app.advance(1);
    await app.fire('ModAction', removedPost());

    expect(lines(app.slack.messages[4]).at(-1)).toBe('• *Status:* Activity spike 5 actions / 1 min');
    expect(lines(app.slack.messages[5]).at(-1)).toBe(WHEN_NOW.replace('12:00:00', '12:01:00'));
  });

  it('counts actions that are not sent: types not enabled and excluded moderators', async () => {
    const app = await loadApp(devvit, { excludedModerators: 'ModA' });

    for (let i = 0; i < 4; i++) {
      await app.fire('ModAction', removedPost({ action: 'lock' }));
    }
    app.settings.excludedModerators = '';
    await app.fire('ModAction', removedPost());

    expect(lines(onlyMessage(app)).at(-1)).toBe('• *Status:* Activity spike 5 actions / 1 min');
  });

  it('keeps at most the 100 most recent actions', async () => {
    const app = await loadApp(devvit);
    const key = 'mod_actions:moderator_activity:testsub:moda';
    app.context.redis.seed(key, JSON.stringify(Array<number>(150).fill(NOW.getTime() - 1000)));

    await app.fire('ModAction', removedPost());

    const stored = JSON.parse(String(await app.context.redis.get(key))) as number[];
    expect(stored).toHaveLength(100);
    expect(stored.at(-1)).toBe(NOW.getTime());
    expect(lines(onlyMessage(app)).at(-1)).toBe('• *Status:* Activity spike 100 actions / 1 min');
  });

  it.each([['not json'], ['{"count":4}'], ['["a", "b", "c", "d"]']])(
    'starts counting afresh when the stored activity is unusable: %s',
    async (stored) => {
      const app = await loadApp(devvit);
      app.context.redis.seed('mod_actions:moderator_activity:testsub:moda', stored);

      await app.fire('ModAction', removedPost());

      expect(lines(onlyMessage(app)).at(-1)).toBe(WHEN_NOW);
    },
  );

  it('is not tracked when the event names no subreddit', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', removedPost({ subreddit: undefined }));

    expect(app.context.redis.keys()).toStrictEqual([]);
    expect(app.slack.requests).toHaveLength(1);
  });

  it('does not stop the message when Redis fails', async () => {
    const app = await loadApp(devvit);
    app.context.redis.get.mockRejectedValue(new Error('redis down'));

    await app.fire('ModAction', removedPost());

    expect(app.slack.requests).toHaveLength(1);
  });
});

describe('a ban', () => {
  // Devvit's ModAction event has no ban duration or reason, so the app looks the ban up in the mod log.
  it('takes its duration and reason from the matching mod log entry', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.modLog = [
      { id: 'ModAction_1', moderatorName: 'ModA', createdAt: NOW, details: '7 days', description: 'Spamming', target: { author: 'Troll' } },
    ];

    await app.fire('ModAction', bannedUser());

    expect(app.context.reddit.getModerationLog).toHaveBeenCalledWith({ subredditName: 'testsub', type: 'banuser', limit: 10 });
    expect(lines(onlyMessage(app))).toStrictEqual([
      '🔔 *Moderator Action*',
      '• *Action:* User Banned',
      '• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>',
      '• *Target:* <https://www.reddit.com/u/Troll|u/Troll>',
      WHEN_NOW,
      '• *Ban Duration:* 7 days',
      '• *Details:* 7 days',
      '• *Mod Note:* Spamming',
    ]);
  });

  it.each([
    ['permanent', 'Permanent Ban'],
    ['1 day', '1 day'],
    ['30d', '30 days'],
    ['until appeal', 'until appeal'],
    // A plural "days" is not parsed as a number (see the legacy-field cases below), so it is shown verbatim.
    ['ban for 7 days', 'ban for 7 days'],
  ])('reads the mod log details %j as a duration of %j', async (details, duration) => {
    const app = await loadApp(devvit);
    app.context.reddit.modLog = [{ id: 'ModAction_1', moderatorName: 'ModA', createdAt: NOW, details, target: { author: 'Troll' } }];

    await app.fire('ModAction', bannedUser());

    expect(lines(onlyMessage(app))).toContain(`• *Ban Duration:* ${duration}`);
  });

  it('leaves out the mod note when mod notes are turned off', async () => {
    const app = await loadApp(devvit, { includeModNote: false });
    app.context.reddit.modLog = [
      { id: 'ModAction_1', moderatorName: 'ModA', createdAt: NOW, details: '7 days', description: 'Spamming', target: { author: 'Troll' } },
    ];

    await app.fire('ModAction', bannedUser());

    expect(lines(onlyMessage(app)).at(-1)).toBe('• *Details:* 7 days');
  });

  it('uses the log entry for the same user banned by the same moderator', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.modLog = [
      { id: 'ModAction_2', moderatorName: 'ModA', createdAt: NOW, details: '3 days', target: { author: 'SomeoneElse' } },
      { id: 'ModAction_1', moderatorName: 'ModA', createdAt: NOW, details: '7 days', target: { author: 'troll' } },
    ];

    await app.fire('ModAction', bannedUser());

    expect(lines(onlyMessage(app))).toContain('• *Ban Duration:* 7 days');
  });

  it('uses the log entry with the event’s ID even when nothing else about it matches', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.modLog = [
      { id: 'ModAction_1', moderatorName: 'ModB', createdAt: new Date(NOW.getTime() - 10 * MINUTE), details: 'permanent', target: { author: 'Other' } },
    ];

    await app.fire('ModAction', bannedUser({ id: 'ModAction_1' }));

    expect(lines(onlyMessage(app))).toContain('• *Ban Duration:* Permanent Ban');
  });

  it('uses the moderator’s latest ban when the event names no target', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.modLog = [
      { id: 'ModAction_2', moderatorName: 'ModB', createdAt: new Date(NOW.getTime() - 3 * MINUTE), details: '3 days', target: { author: 'X' } },
      { id: 'ModAction_1', moderatorName: 'MODA', createdAt: NOW, details: '7 days', target: { author: 'Y' } },
    ];

    await app.fire('ModAction', bannedUser({ targetUser: undefined }));

    expect(lines(onlyMessage(app))).toContain('• *Ban Duration:* 7 days');
  });

  it('uses any ban from the last two minutes when the event names no target', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.modLog = [
      { id: 'ModAction_2', moderatorName: 'ModB', createdAt: new Date(NOW.getTime() - MINUTE), details: '3 days', target: { author: 'X' } },
    ];

    await app.fire('ModAction', bannedUser({ targetUser: undefined }));

    expect(lines(onlyMessage(app))).toContain('• *Ban Duration:* 3 days');
  });

  it('uses another moderator’s ban of the same user from the last two minutes', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.modLog = [
      { id: 'ModAction_2', moderatorName: 'ModB', createdAt: new Date(NOW.getTime() - 3 * MINUTE), details: '3 days', target: { author: 'Troll' } },
      { id: 'ModAction_1', moderatorName: 'ModB', createdAt: new Date(NOW.getTime() - 2 * MINUTE), details: '7 days', target: { author: 'Troll' } },
    ];

    await app.fire('ModAction', bannedUser());

    expect(lines(onlyMessage(app))).toContain('• *Ban Duration:* 7 days');
  });

  it('shows an unknown duration when no log entry matches', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.modLog = [
      { id: 'ModAction_2', moderatorName: 'ModB', createdAt: new Date(NOW.getTime() - 3 * MINUTE), details: '3 days', target: { author: 'Troll' } },
    ];

    await app.fire('ModAction', bannedUser());

    const banLines = lines(onlyMessage(app));
    expect(banLines).toContain('• *Ban Duration:* Unknown Duration');
    expect(banLines.some((line) => line.startsWith('• *Details:*'))).toBe(false);
  });

  it('shows an unknown duration when the mod log is empty', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', bannedUser());

    expect(lines(onlyMessage(app))).toContain('• *Ban Duration:* Unknown Duration');
  });

  it('shows an unknown duration when the mod log cannot be read', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.getModerationLog.mockImplementation(() => {
      throw new Error('reddit down');
    });

    await app.fire('ModAction', bannedUser());

    expect(lines(onlyMessage(app))).toContain('• *Ban Duration:* Unknown Duration');
  });

  it('asks Reddit for the subreddit name when the event has none', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', bannedUser({ subreddit: undefined }));

    expect(app.context.reddit.getCurrentSubredditName).toHaveBeenCalledTimes(1);
    expect(app.context.reddit.getModerationLog).toHaveBeenCalledWith({ subredditName: 'testsub', type: 'banuser', limit: 10 });
  });

  it('skips the mod log when Reddit returns no subreddit name', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.getCurrentSubredditName.mockResolvedValue('');

    await app.fire('ModAction', bannedUser({ subreddit: undefined }));

    expect(app.context.reddit.getModerationLog).not.toHaveBeenCalled();
  });

  it.each([
    [{ duration: 7 }, '7 days'],
    [{ banDuration: 1 }, '1 day'],
    [{ days: 0 }, 'Permanent Ban'],
    [{ details: '3d' }, '3 days'],
    [{ details: 'Permanent' }, 'Permanent Ban'],
    [{ details: 'until appeal' }, 'until appeal'],
    // parseBanDuration's /(\d+)\s*(?:day|d)\b/ never matches a plural "days", so such text is shown verbatim.
    [{ description: 'Banned for 14 days' }, 'Banned for 14 days'],
    [{ description: 'Banned for 14 day' }, '14 days'],
    [{ description: 'no length given' }, 'no length given'],
  ])('reads the duration from the legacy event field %j as %j', async (legacyFields, duration) => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', { ...bannedUser(), ...legacyFields });

    expect(lines(onlyMessage(app))).toContain(`• *Ban Duration:* ${duration}`);
    expect(app.context.reddit.getModerationLog).not.toHaveBeenCalled();
  });
});

describe('an unban or unmute', () => {
  it('reminds moderators of the ban it lifts', async () => {
    const app = await loadApp(devvit);
    app.context.reddit.modLog = [
      { id: 'ModAction_1', moderatorName: 'ModA', createdAt: NOW, details: '7 days', description: 'Spamming', target: { author: 'Troll' } },
    ];
    await app.fire('ModAction', bannedUser());
    await app.advance(24 * 60 * MINUTE);

    await app.fire('ModAction', modActionEvent({ action: 'unbanuser', moderator: { name: 'ModB' }, targetUser: { name: 'Troll' } }));

    expect(lines(app.slack.messages[1])).toContain(
      '• *Related Ban:* Moderator <https://www.reddit.com/u/ModA|u/ModA> • on 2026-11-04T12:00:00.000Z • Details 7 days',
    );
  });

  it('keeps the ban in Redis for 90 days, and forgets it once the user is unbanned', async () => {
    const app = await loadApp(devvit);
    const key = 'mod_actions:discipline:ban:testsub:troll';

    await app.fire('ModAction', bannedUser());
    expect(app.context.redis.ttlSeconds(key)).toBe(90 * 24 * 60 * 60);
    expect(JSON.parse(String(await app.context.redis.get(key)))).toStrictEqual({
      type: 'ban',
      moderatorName: 'ModA',
      timestamp: NOW.getTime(),
      description: '',
      details: null,
    });

    const unban = modActionEvent({ action: 'unbanuser', moderator: { name: 'ModB' }, targetUser: { name: 'Troll' } });
    await app.fire('ModAction', unban);
    await app.fire('ModAction', unban);

    expect(app.context.redis.keys()).not.toContain(key);
    expect(lines(app.slack.messages[1])).toContain(
      '• *Related Ban:* Moderator <https://www.reddit.com/u/ModA|u/ModA> • on 2026-11-04T12:00:00.000Z',
    );
    expect(lines(app.slack.messages[2]).some((line) => line.startsWith('• *Related Ban:*'))).toBe(false);
  });

  it('reminds moderators of the mute it lifts', async () => {
    const app = await loadApp(devvit, { enabledActions: ['muteuser', 'unmuteuser'] });

    await app.fire('ModAction', modActionEvent({ action: 'muteuser', moderator: { name: 'ModA' }, targetUser: { name: 'Troll' } }));
    expect(app.context.redis.keys()).toContain('mod_actions:discipline:mute:testsub:troll');
    await app.fire('ModAction', modActionEvent({ action: 'unmuteuser', moderator: { name: 'ModB' }, targetUser: { name: 'Troll' } }));

    expect(lines(app.slack.messages[1])).toContain(
      '• *Related Mute:* Moderator <https://www.reddit.com/u/ModA|u/ModA> • on 2026-11-04T12:00:00.000Z',
    );
  });

  it('remembers bans even when ban notifications are off', async () => {
    const app = await loadApp(devvit, { enabledActions: ['unbanuser'] });

    await app.fire('ModAction', bannedUser());
    await app.fire('ModAction', modActionEvent({ action: 'unbanuser', moderator: { name: 'ModB' }, targetUser: { name: 'Troll' } }));

    expect(lines(onlyMessage(app)).some((line) => line.startsWith('• *Related Ban:*'))).toBe(true);
  });

  it.each([['not json'], ['{}']])('says nothing about a stored ban it cannot use: %s', async (stored) => {
    const app = await loadApp(devvit);
    const key = 'mod_actions:discipline:ban:testsub:troll';
    app.context.redis.seed(key, stored);

    await app.fire('ModAction', modActionEvent({ action: 'unbanuser', moderator: { name: 'ModB' }, targetUser: { name: 'Troll' } }));

    expect(lines(onlyMessage(app)).some((line) => line.startsWith('• *Related Ban:*'))).toBe(false);
    expect(app.context.redis.keys()).not.toContain(key);
  });

  it('is still sent when Redis fails', async () => {
    const app = await loadApp(devvit);
    app.context.redis.get.mockRejectedValue(new Error('redis down'));
    app.context.redis.set.mockRejectedValue(new Error('redis down'));

    await app.fire('ModAction', bannedUser());
    await app.fire('ModAction', modActionEvent({ action: 'unbanuser', moderator: { name: 'ModB' }, targetUser: { name: 'Troll' } }));

    expect(app.slack.messages.map((message) => message.text)).toStrictEqual(['🔨 User Banned', '🎉 User Unbanned']);
  });
});

describe('a crowd control change', () => {
  const crowdControl = 'adjust_post_crowd_control_level';

  it('shows the new level from the details, and no mod note', async () => {
    const app = await loadApp(devvit, { enabledActions: [crowdControl] });

    await app.fire('ModAction', { ...removedPost({ action: crowdControl }), details: 'MEDIUM', description: 'Busy thread' });

    const messageLines = lines(onlyMessage(app));
    expect(messageLines.at(-1)).toBe('• *Level:* MEDIUM');
    expect(messageLines.some((line) => line.startsWith('• *Mod Note:*'))).toBe(false);
  });

  it('shows the description when there are no details', async () => {
    const app = await loadApp(devvit, { enabledActions: [crowdControl] });

    await app.fire('ModAction', { ...removedPost({ action: crowdControl }), description: 'Raised to strict' });

    expect(lines(onlyMessage(app)).at(-1)).toBe('• *Change:* Raised to strict');
  });

  it('shows neither when the event has neither', async () => {
    const app = await loadApp(devvit, { enabledActions: [crowdControl] });

    await app.fire('ModAction', removedPost({ action: crowdControl }));

    expect(lines(onlyMessage(app)).at(-1)).toBe(WHEN_NOW);
  });
});

describe('legacy event shapes', () => {
  const TEN_THIRTY = Date.parse('2026-11-04T10:30:00Z');

  it.each([
    ['an ISO createdAt', { createdAt: '2026-11-04T10:30:00Z' }, TEN_THIRTY],
    ['a Date createdAt', { createdAt: new Date(TEN_THIRTY) }, TEN_THIRTY],
    ['created_at in seconds', { created_at: TEN_THIRTY / 1000 }, TEN_THIRTY],
    ['triggeredAt in milliseconds', { triggeredAt: TEN_THIRTY }, TEN_THIRTY],
    ['triggered_at', { triggered_at: TEN_THIRTY }, TEN_THIRTY],
    ['a protobuf timestamp', { timestamp: { seconds: TEN_THIRTY / 1000, nanos: 500_000_000 } }, TEN_THIRTY + 500],
    ['a protobuf timestamp without nanos', { timestamp: { seconds: TEN_THIRTY / 1000 } }, TEN_THIRTY],
    ['an unparseable createdAt', { createdAt: 'yesterday' }, NOW.getTime()],
    ['a createdAt of another type', { createdAt: true }, NOW.getTime()],
  ])('are timed by %s', async (_label, legacyFields, expected) => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', { ...removedPost(), ...legacyFields });

    const message = onlyMessage(app);
    expect(message.attachments?.[0]?.ts).toBe(Math.floor(expected / 1000));
    expect(lines(message)).toContain(`• *When:* ${new Date(expected).toISOString().replace('T', ' ').replace(/\..+/, ' UTC')}`);
  });

  it('read the action from a nested modAction object', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', {
      action: 'removelink',
      moderator: { name: 'ModA' },
      subreddit: { name: 'testsub' },
      modAction: {
        id: 42,
        description: 'Nested note',
        details: 7,
        target: { author: 'Nested', permalink: '/r/testsub/comments/n/', body: 'Nested body' },
      },
    });

    expect(lines(onlyMessage(app))).toStrictEqual([
      '🔔 *Moderator Action*',
      '• *Action:* Post Removed',
      '• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>',
      '• *Target:* <https://www.reddit.com/u/Nested|u/Nested>',
      '• *Content:* <https://www.reddit.com/r/testsub/comments/n/|View Comment>',
      '> Nested body',
      WHEN_NOW,
      '• *Details:* 7',
      '• *Mod Note:* Nested note',
    ]);
  });

  it('read a target that has only a title from a lower-case modaction object', async () => {
    const app = await loadApp(devvit);

    await app.fire('ModAction', {
      action: 'removelink',
      moderator: { name: 'ModA' },
      modaction: { target: { title: 'Only a title' } },
    });

    expect(lines(onlyMessage(app))).toStrictEqual([
      '🔔 *Moderator Action*',
      '• *Action:* Post Removed',
      '• *Moderator:* <https://www.reddit.com/u/ModA|u/ModA>',
      '> Only a title',
      WHEN_NOW,
    ]);
  });
});
