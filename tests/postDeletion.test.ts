import { describe, expect, it, vi } from 'vitest';
import { loadApp, NOW } from './support/app';
import { DeletionReason, EventSource, postCreateEvent, postDeleteEvent, postUpdateEvent } from './support/events';

const devvit = await vi.hoisted(async () => (await import('./support/fakeDevvit')).createFakeDevvit());
vi.mock('@devvit/public-api', () => ({ Devvit: devvit.api }));

const CACHE_KEY = 'post_score:t3_big';
const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

function bigPost(score: number) {
  return {
    id: 't3_big',
    title: 'Big post',
    score,
    permalink: '/r/testsub/comments/big/big_post/',
    authorId: 't2_poster',
    subredditId: 't5_testsub',
  };
}

function userDeletion(fields: Parameters<typeof postDeleteEvent>[0] = {}) {
  return postDeleteEvent({
    postId: 't3_big',
    source: EventSource.USER,
    reason: DeletionReason.OTHER,
    deletedAt: new Date('2026-11-04T13:00:00Z'),
    author: { name: 'Poster' },
    ...fields,
  });
}

describe('a new or updated post', () => {
  it('is remembered for seven days once its score reaches half the deletion threshold', async () => {
    const app = await loadApp(devvit);

    await app.fire('PostCreate', postCreateEvent({ post: bigPost(50), author: { name: 'Poster' } }));

    expect(app.context.redis.keys()).toStrictEqual([CACHE_KEY]);
    expect(app.context.redis.ttlSeconds(CACHE_KEY)).toBe(SEVEN_DAYS_SECONDS);
  });

  // Devvit's PostV2 has authorId and subredditId but no authorName or subredditName, which the app reads.
  it('is remembered with its author and subreddit as Unknown', async () => {
    const app = await loadApp(devvit);

    await app.fire('PostCreate', postCreateEvent({ post: bigPost(50), author: { name: 'Poster' } }));

    expect(JSON.parse(String(await app.context.redis.get(CACHE_KEY)))).toStrictEqual({
      score: 50,
      title: 'Big post',
      authorName: 'Unknown',
      permalink: '/r/testsub/comments/big/big_post/',
      subredditName: 'Unknown',
    });
  });

  it('is not remembered below half the deletion threshold', async () => {
    const app = await loadApp(devvit);

    await app.fire('PostCreate', postCreateEvent({ post: bigPost(49) }));

    expect(app.context.redis.keys()).toStrictEqual([]);
  });

  it('is remembered with its latest score as it is updated', async () => {
    const app = await loadApp(devvit);

    await app.fire('PostCreate', postCreateEvent({ post: bigPost(60) }));
    await app.fire('PostUpdate', postUpdateEvent({ post: bigPost(150) }));

    expect(JSON.parse(String(await app.context.redis.get(CACHE_KEY)))).toMatchObject({ score: 150 });
  });

  it('is not remembered when deletion alerts are off', async () => {
    const app = await loadApp(devvit, { postDeletionUpvoteThreshold: 0 });

    await app.fire('PostCreate', postCreateEvent({ post: bigPost(5000) }));

    expect(app.context.redis.keys()).toStrictEqual([]);
  });

  it.each([
    ['an event without a post', postCreateEvent({})],
    ['a post without an ID', postCreateEvent({ post: { score: 500 } })],
    ['a post without a score', { post: { id: 't3_big' } }],
  ])('is ignored for %s', async (_label, event) => {
    const app = await loadApp(devvit);

    await app.fire('PostCreate', event);

    expect(app.context.redis.keys()).toStrictEqual([]);
  });

  it('records missing fields of a legacy post as defaults', async () => {
    const app = await loadApp(devvit);

    await app.fire('PostUpdate', { post: { id: 't3_big', score: 80 } });

    expect(JSON.parse(String(await app.context.redis.get(CACHE_KEY)))).toStrictEqual({
      score: 80,
      title: 'Untitled',
      authorName: 'Unknown',
      permalink: '',
      subredditName: 'Unknown',
    });
  });

  it.each([
    ['200', 99, false],
    ['200', 100, true],
    [140.9, 70, true],
    ['not a number', 49, false],
    ['not a number', 50, true],
    [-5, 5000, false],
  ])('reads a threshold setting of %j: a score of %i is remembered: %s', async (threshold, score, remembered) => {
    const app = await loadApp(devvit, { postDeletionUpvoteThreshold: threshold });

    await app.fire('PostCreate', postCreateEvent({ post: bigPost(score) }));

    expect(app.context.redis.keys()).toStrictEqual(remembered ? [CACHE_KEY] : []);
  });

  it('is not remembered when Redis fails, and the trigger still succeeds', async () => {
    const app = await loadApp(devvit);
    app.context.redis.set.mockRejectedValue(new Error('redis down'));

    await app.fire('PostCreate', postCreateEvent({ post: bigPost(500) }));

    expect(app.context.redis.keys()).toStrictEqual([]);
  });
});

describe('a user deleting a remembered post', () => {
  it('alerts Slack when the post had at least the threshold score', async () => {
    const app = await loadApp(devvit);
    await app.fire('PostCreate', postCreateEvent({ post: bigPost(150) }));

    await app.fire('PostDelete', userDeletion());

    // The reason is Devvit's numeric DeletionReason, sent as it is.
    expect(app.slack.messages).toStrictEqual([
      {
        text: '🗑️ User Deleted High-Score Post: 150 upvotes',
        username: 'Reddit Mod Bot',
        icon_emoji: ':wastebasket:',
        attachments: [
          {
            color: '#cc0000',
            fields: [
              { title: '📝 Title', value: 'Big post', short: false },
              { title: '👤 Author', value: '/u/Unknown', short: true },
              { title: '⬆️ Score', value: '150', short: true },
              { title: '🗑️ Reason', value: DeletionReason.OTHER, short: true },
              { title: '📍 Subreddit', value: '/r/Unknown', short: true },
              { title: '🔗 Link (may be dead)', value: 'https://reddit.com/r/testsub/comments/big/big_post/', short: false },
              { title: '⏰ Deleted At', value: '2026-11-04T13:00:00.000Z', short: true },
            ],
            footer: 'Reddit Mod Action Bot - Post Deletion Monitor',
            ts: Math.floor(NOW.getTime() / 1000),
          },
        ],
      },
    ]);
  });

  it('forgets the post once it has alerted', async () => {
    const app = await loadApp(devvit);
    await app.fire('PostCreate', postCreateEvent({ post: bigPost(150) }));

    await app.fire('PostDelete', userDeletion());
    await app.fire('PostDelete', userDeletion());

    expect(app.slack.requests).toHaveLength(1);
    expect(app.context.redis.keys()).toStrictEqual([]);
  });

  it('sends the alert to the alert channel', async () => {
    const app = await loadApp(devvit, { alertChannel: 'alerts', notificationChannel: 'mod-log' });
    await app.fire('PostCreate', postCreateEvent({ post: bigPost(150) }));

    await app.fire('PostDelete', userDeletion());

    expect(app.slack.messages[0]?.channel).toBe('#alerts');
  });

  it('gives the current time as the deletion time when the event has none', async () => {
    const app = await loadApp(devvit);
    await app.fire('PostCreate', postCreateEvent({ post: bigPost(150) }));

    await app.fire('PostDelete', userDeletion({ deletedAt: undefined }));

    expect(app.slack.messages[0]?.attachments?.[0]?.fields?.at(-1)).toStrictEqual({
      title: '⏰ Deleted At',
      value: NOW.toISOString(),
      short: true,
    });
  });

  it('names the event’s subreddit, and an Unknown reason, for a post remembered without them', async () => {
    const app = await loadApp(devvit);
    app.context.redis.seed(
      CACHE_KEY,
      JSON.stringify({ score: 150, title: 'Big post', authorName: 'Poster', permalink: '/r/testsub/x/', subredditName: '' }),
    );

    await app.fire('PostDelete', { postId: 't3_big', source: EventSource.USER, subreddit: { name: 'testsub' } });

    const fields = app.slack.messages[0]?.attachments?.[0]?.fields;
    expect(fields?.find((field) => field.title === '👤 Author')?.value).toBe('/u/Poster');
    expect(fields?.find((field) => field.title === '📍 Subreddit')?.value).toBe('/r/testsub');
    expect(fields?.find((field) => field.title === '🗑️ Reason')?.value).toBe('Unknown');
  });

  it('is not alerted below the threshold, and the post stays remembered', async () => {
    const app = await loadApp(devvit);
    await app.fire('PostCreate', postCreateEvent({ post: bigPost(99) }));

    await app.fire('PostDelete', userDeletion());

    expect(app.slack.requests).toStrictEqual([]);
    expect(app.context.redis.keys()).toStrictEqual([CACHE_KEY]);
  });

  it.each([
    ['a moderator', EventSource.MODERATOR],
    ['an admin', EventSource.ADMIN],
  ])('is not alerted when %s deletes the post', async (_label, source) => {
    const app = await loadApp(devvit);
    await app.fire('PostCreate', postCreateEvent({ post: bigPost(150) }));

    await app.fire('PostDelete', userDeletion({ source }));

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('is not alerted for a post the app never saw', async () => {
    const app = await loadApp(devvit);

    await app.fire('PostDelete', userDeletion());

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('is not alerted when the event has no post ID', async () => {
    const app = await loadApp(devvit);

    await app.fire('PostDelete', userDeletion({ postId: '' }));

    expect(app.slack.requests).toStrictEqual([]);
    expect(console.error).toHaveBeenCalledWith('PostDelete event missing postId');
  });

  it('is not alerted when deletion alerts are off', async () => {
    const app = await loadApp(devvit, { postDeletionUpvoteThreshold: 0 });
    app.context.redis.seed(CACHE_KEY, JSON.stringify({ score: 5000, title: 'T', authorName: 'A', permalink: '/p/', subredditName: 's' }));

    await app.fire('PostDelete', userDeletion());

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('is not alerted without a webhook', async () => {
    const app = await loadApp(devvit, { slackWebhookUrl: '' });
    await app.fire('PostCreate', postCreateEvent({ post: bigPost(150) }));

    await app.fire('PostDelete', userDeletion());

    expect(app.slack.requests).toStrictEqual([]);
  });

  it('logs a remembered post it cannot read, and the trigger still succeeds', async () => {
    const app = await loadApp(devvit);
    app.context.redis.seed(CACHE_KEY, 'not json');

    await app.fire('PostDelete', userDeletion());

    expect(app.slack.requests).toStrictEqual([]);
    expect(console.error).toHaveBeenCalledWith('Failed to handle post delete:', expect.any(SyntaxError));
  });
});
