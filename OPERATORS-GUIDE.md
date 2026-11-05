# Operators Guide

This guide is for the people who deploy the Reddit Mod Action Slack Bot, configure it for a subreddit, and keep it running. It explains how the app works, how to deploy and upgrade it, what it stores, and how to troubleshoot it. The [README](./README.md) describes what the app does. [AGENTS.md](./AGENTS.md) covers the architecture and conventions for contributors.

## How it works

The app is a Devvit app. Reddit runs it, and it acts only when Reddit calls it:

```text
Mod action, post deleted ─┐
                          ├─► checks and context ─► alert ─► Slack outbox (Redis) ─► Slack webhook
Every 15 minutes ─────────┘
Mod tools menu ─► Test Slack Connection, Simulate Mod Action ─────────────────────► Slack webhook
```

| Reddit calls it for                              | It does                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| A mod action (`ModAction` trigger)               | Records the action's context, and sends an alert if your settings ask for one. |
| A deleted post (`PostDelete` trigger)            | Alerts when a user deletes their own high-scoring post.                        |
| The `modqueueMonitor` job, every 15 minutes      | Checks the modqueue, unmoderated and reports listings against your thresholds. |
| The `slackOutbox` job, scheduled as needed       | Delivers alerts still waiting in the queue.                                    |
| Install and upgrade (`AppInstall`, `AppUpgrade`) | Schedules or cancels the modqueue monitor to match your settings.              |
| The mod tools menu                               | Runs the four menu actions, for moderators only.                               |

## Deploying

### Requirements

- Node.js 22.13 or later, 24, or 26.
- A Reddit account that moderates the subreddit. The Devvit command-line tool comes with the project's dependencies.

### Build, check and upload

```bash
git clone https://github.com/ivashkin-reddit/mod-action-notifications.git
cd mod-action-notifications
npm ci

# The checks CI runs
npm run typecheck
npm run lint
npm run coverage
npm run format:check

npx devvit login
npx devvit playtest <test-subreddit>   # optional: try it live on a test subreddit
npx devvit upload
npx devvit install <your-subreddit>
```

After installing, follow the [README's Getting started](./README.md#getting-started) to configure it.

### Before the first release

- **Domain approval.** The app fetches `hooks.slack.com`. Reddit reviews requested domains when you first playtest or upload, and alerts can't reach Slack until it's approved.
- **Legal links.** Apps that fetch external domains must link to their terms and privacy policy in the app's details form on developers.reddit.com. Use [TERMS-AND-CONDITIONS.md](./TERMS-AND-CONDITIONS.md) and [PRIVACY-POLICY.md](./PRIVACY-POLICY.md).

### Permissions

[devvit.json](./devvit.json) requests:

- **Reddit API:** reads only. The mod list, the mod log's bans, posts, the modqueue, unmoderated and reports listings, and the permissions of the user who opens a menu action. The app never posts, removes, bans or messages.
- **Redis:** the stores listed under [Data stored](#data-stored).
- **HTTP:** `hooks.slack.com` only.
- **Triggers:** `onAppInstall`, `onAppUpgrade`, `onModAction`, `onPostDelete`.

### Upgrading

Upload a new version. Each installation then upgrades, and the `AppUpgrade` trigger runs monitor setup again, which leaves exactly one monitor job scheduled.

Data written by earlier versions is carried over as it's used:

- **Ban and mute records** kept under the earlier format (`mod_actions:discipline:*`) are moved to the current one the first time they're needed. The old key is then deleted. Records nobody needs expire within 90 days.
- **The monitor job ID** that earlier versions kept (`modqueue_monitor_job_id`) is deleted by setup. The scheduler itself now says which job runs.

**Rolling back.** If you go back to an earlier version, it can't read ban and mute records that were already moved. It also never delivers alerts left in the queue by this version.

### Uninstalling

Uninstalling removes the installation's settings and stored data. Reinstalling starts fresh.

## Configuration

Moderators set these under the app's settings for the subreddit. The stored names are permanent; renaming one would lose what installations have saved.

| Setting (stored name)                                                                             | Accepted values                       | Effect                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Slack Webhook URL (`slackWebhookUrl`)                                                             | `https://hooks.slack.com/…`, or blank | Where alerts go. Blank turns off every alert.                                                                |
| Enabled Mod Actions (`enabledActions`)                                                            | any of 31 action types                | Which actions send an alert.                                                                                 |
| Excluded Moderators (`excludedModerators`)                                                        | usernames separated by commas         | Their actions never send an alert. Names are matched ignoring case.                                          |
| Flag Unknown Moderators (`flagUnknownModerators`)                                                 | on or off                             | Actions by accounts not on the mod list become security alerts.                                              |
| Include Mod Note (`includeModNote`)                                                               | on or off                             | Shows the moderator's note. Reddit's events carry none, so notes appear on bans only, read from the mod log. |
| Notification Channel (`notificationChannel`)                                                      | a channel name, with or without `#`   | Channel for moderator and Reddit actions.                                                                    |
| Alert Channel (`alertChannel`)                                                                    | a channel name, with or without `#`   | Channel for security, modqueue and deleted-post alerts. Falls back to the notification channel.              |
| Modqueue Size Alert Threshold (`modqueueThreshold`)                                               | a whole number of 0 or more           | Alert when the modqueue holds at least this many items.                                                      |
| Unmoderated Content Age Alert (Hours) (`unmoderagedAgeHours`, spelt this way when it was created) | a whole number of 0 or more           | Alert when unreviewed content is at least this many hours old.                                               |
| Old Reported Content Alert (Hours) (`reportedContentAgeHours`)                                    | a whole number of 0 or more           | Alert when reported content is at least this many hours old.                                                 |
| Enable AutoModerator Slack Alerts (`enableAutoModAlerts`)                                         | on or off                             | Also alert for AutoModerator's actions.                                                                      |
| Post Deletion Alert Threshold (`postDeletionUpvoteThreshold`)                                     | a whole number of 0 or more           | Alert when a user deletes their own post with at least this score.                                           |

A threshold of 0 turns its alert off. Turning all three modqueue thresholds off turns the monitor off once **Setup Modqueue Monitoring** runs.

**Saving.** The settings form rejects a webhook URL on any other host, and any threshold that isn't a whole number of 0 or more.

**Reading.**

- A value that still can't be used falls back to its default, and a webhook URL on another host is treated as blank.
- If the settings can't be read at all, the app uses the last settings it read for that subreddit, logging the failure.

**Channels.** The channel settings need a legacy incoming webhook. A webhook created by a Slack app ignores them and posts to the channel it was created for.

## Alerts in detail

### Mod action alerts

For each mod action, the app works through these steps. Steps 2 to 4 happen even for actions that send no alert, so the context is there when it's needed.

1. **No webhook?** Then nothing happens, and the app logs `Slack webhook URL not configured - skipping notification`.
2. **Ban length.** For a ban that doesn't say how long it lasts, the app reads the mod log's 10 most recent bans and takes the matching entry. It tries the entry with the action's own ID first, then one for the same user by the same moderator, then one by the same moderator, and last one within two minutes of the action.
3. **Ban and mute history.** Every ban, mute, unban and unmute is recorded for 90 days, keeping the latest 20 per user. An unban or unmute alert names the latest ban or mute taken before it. This works even when Reddit delivers the events out of order.
4. **Activity.** Each action counts toward its moderator's activity by the time it was taken, apart from AutoModerator's and Reddit's actions. A moderator's fifth action within a minute marks a spike.
5. **Should it alert?** Only if the action's type is enabled, its moderator isn't excluded, and it isn't AutoModerator's while AutoModerator alerts are off.
6. **Who acted.**
    - An action by u/reddit or Anti-Evil Operations is a Reddit action.
    - Otherwise, with Flag Unknown Moderators on, the app checks the mod list, reusing it for five minutes per subreddit.
    - An account not on the list makes a security alert. If the mod list can't be read, the action is treated as a moderator's.
7. **Once per action.** The action's ID is claimed for a day, so an event Reddit delivers again sends no second alert.
8. **Queued** for Slack.

**Alert content.** An alert names:

- the action, the moderator, and the user acted on;
- a link to the content and a quote of up to 200 characters;
- when the action was taken (UTC);
- for bans, the length, any details, and the mod note if enabled;
- for unbans and unmutes, the ban or mute lifted;
- a status line for unknown moderators, AutoModerator, Reddit's accounts and activity spikes.

Text from Reddit is escaped, so text such as `<!channel>` in a post shows as written and notifies no one.

**Channels.** Security alerts go to the alert channel; moderator and Reddit actions go to the notification channel.

### Deleted-post alerts

These cover only posts deleted by their own author, not removals by moderators or admins.

- **Score.** The app reads the post's score from Reddit at the moment of deletion, because votes fire no event the app could track. It alerts when the score reaches the threshold.
- **Content.** The alert gives the title, author, score, Reddit's deletion reason and a link, which may no longer work.
- **Channel.** It goes to the alert channel.
- **Once per post.** The post's ID is claimed for a day, so one deletion sends one alert.

### Modqueue monitor

The monitor runs every 15 minutes while any of its thresholds is above 0 and **Setup Modqueue Monitoring** has run. Install and upgrade run setup automatically.

- **What it reads.** Each run reads only the listings whose alerts are on: the modqueue, Reddit's unmoderated listing, and the reports listing.
- **The alerts:**
    - `⚠️ Modqueue Alert: N items pending`, with a count of posts and comments, when the modqueue reaches its threshold.
    - `⏰ Unmoderated Content Alert` when content has waited past its age.
    - `📣 Old Reported Content Alert` when reported content has passed its age.

    The two age alerts list the five oldest items.

- **Throttling.** Each kind of alert is sent at most once an hour.
- **Failures.**
    - Every failed run is counted. The count is forgotten an hour after the last failure, and cleared by a run that succeeds.
    - The third failure in a row sends `⚠️ Critical: Modqueue Monitoring Failed N Times` to the alert channel.

## Delivery to Slack

Slack accepts about one message a second from an incoming webhook. Every alert therefore goes through the **outbox**, a queue in Redis:

- **Ordering.** One delivery run works the queue at a time, oldest alert first. Each run holds a lease that lasts 46.1 seconds.
- **Pacing.**
    - Messages go out at least 1.1 seconds apart, including across runs. A run reads when the last one sent.
    - When Slack sends a Retry-After, the run waits as long as it asks.
- **Retries.** A request that fails is retried after 1, 2 and 4 seconds, at most three times in one run.
- **Run length.**
    - A run delivers for up to 10 seconds. A follow-up run, scheduled a second later, delivers the rest.
    - While Slack keeps failing, the queue waits 30 seconds, or as long as Slack asked, before the next run.
- **Recovery.** If a run is cut off by Reddit's time limit, for instance during a slow Slack request, a recovery run after its lease expires delivers what it left.
- **Limits.**
    - The queue holds at most 500 alerts; beyond that the oldest are dropped.
    - An alert still queued after a day is dropped.
    - Slack refusing an alert (for example a revoked webhook) drops it.

    Every drop is logged.

- **Possible duplicates.** Delivery is at least once. If Slack accepted a request but the answer was lost, or a run was cut off mid-request, the alert is sent again.

**Direct sends.** **Test Slack Connection** and **Simulate Mod Action** skip the queue, because a moderator is waiting for the answer. They retry after 1, 2 and 4 seconds before reporting failure.

## Data stored

**Redis.** All of this is per installation. Every key expires, or is cleared once it's used.

| Key                                                               | Holds                                                                      | Kept for      | Limit         |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------- | ------------- |
| `mod_actions:moderator_actions:{subreddit}:{moderator}`           | the moderator's recent action IDs, by time                                 | 1 hour        | 100 actions   |
| `mod_actions:discipline_events:{ban\|mute}:{subreddit}:{user}`    | the user's bans or mutes and their lifting: time, moderator, note, details | 90 days       | 20 events     |
| `mod_actions:reported:{actionId}`                                 | that an action was alerted                                                 | 1 day         | one per alert |
| `post_deletion:alerted:{postId}`                                  | that a deletion was alerted                                                | 1 day         | one per alert |
| `mod_actions:throttle:modqueue_{size\|unmoderated\|reported}`     | that an alert of that kind was sent                                        | 1 hour        | 3 keys        |
| `scheduler_failure_count`                                         | the monitor's failures in a row                                            | 1 hour        | 1 key         |
| `slack_outbox`                                                    | queued alerts                                                              | 1 day         | 500 alerts    |
| `slack_outbox_lease`                                              | which run is delivering                                                    | 46.1 seconds  | 1 key         |
| `slack_outbox_last_sent`                                          | when Slack was last sent a message                                         | 1 minute      | 1 key         |
| `slack_outbox_drain_scheduled`, `slack_outbox_recovery_scheduled` | that a follow-up or recovery run is scheduled                              | until it runs | 1 key each    |

**Settings** are stored by Devvit for each installation. The webhook URL is an ordinary setting, because Devvit allows only app-wide secrets, so any moderator who can open the app's settings can read it.

**Slack.** Alerts quote Reddit content: titles, and excerpts of up to 200 characters of removed posts and comments. Once an alert reaches Slack, it stays there under your workspace's message retention. An incoming webhook can't edit or delete what it posted, so content later deleted on Reddit isn't removed from Slack.

**Logs.** Devvit keeps the app's logs for 7 days, up to 5,000 entries. They name moderators and record errors. The app doesn't log the webhook URL itself, though an error from Devvit's HTTP client could include it.

## Access control

Reddit shows the four menu actions only to moderators, but Devvit runs a menu action's handler for whoever invokes it. So each menu action, and each form it opens, checks that the user has moderator permissions in the subreddit. If they don't, or if Reddit can't say, the action is refused with `🔒 Only this subreddit's moderators can use this.`

## Troubleshooting

### Show Bot Status

The status reads like `Modqueue Monitoring: ON • Slack Webhook: Configured • Modqueue Monitor: Active (cron */15 * * * *)`.

| Part                                    | Meaning                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `Modqueue Monitoring: ON` / `OFF`       | Whether any modqueue threshold is above 0.                                    |
| `Slack Webhook: Configured` / `Missing` | Whether a usable webhook URL is set.                                          |
| `Modqueue Monitor: Active (cron …)`     | The monitor job is scheduled.                                                 |
| `Modqueue Monitor: Not scheduled`       | No monitor job. Run **Setup Modqueue Monitoring** if monitoring should be on. |
| `Modqueue Monitor: Unknown`             | The scheduler couldn't be asked. Try again shortly.                           |

### Test Slack Connection

| Result                                    | Meaning                                                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `🧪 Test alert sent!`                     | Slack accepted the message. If nothing appears, check the channel the webhook posts to.            |
| `⚠️ No Slack webhook URL is set.`         | Add the webhook URL in the app's settings.                                                         |
| `❌ Slack did not accept the test alert.` | Slack refused it or couldn't be reached. Check the webhook hasn't been revoked, and read the logs. |

### Common problems

- **No alerts at all.**
    - Run **Test Slack Connection**.
    - Check the action types are enabled and the moderator isn't excluded.
    - Check AutoModerator alerts are on, if the actions are AutoModerator's.
- **Alerts in the wrong channel.** Channel settings only work with legacy incoming webhooks. Without an alert channel, security, modqueue and deleted-post alerts go to the notification channel.
- **Alerts arriving slowly during busy periods.** That's the 1.1-second pacing at work. A burst of 60 actions takes about a minute to deliver.
- **An alert sent twice.** This is rare: Slack accepted it but its answer was lost, so it was resent.
- **No modqueue alerts.**
    - Show Bot Status should say the monitor is active.
    - The listing must reach the threshold.
    - Each kind of alert is held back for an hour after it's sent.
- **A deleted-post alert that never came.** Only deletions by the post's author count, and the score is the one Reddit reports at the moment of deletion.

### Reading the logs

Read the logs with `npx devvit logs <your-subreddit>`. These are the messages that need attention; most others note a failure the app recovered from.

| Message                                                                | Meaning                                                                                     |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `Slack webhook URL not configured - skipping notification`             | No usable webhook URL is set.                                                               |
| `Invalid Slack webhook URL: must be an https://hooks.slack.com/ URL`   | The saved URL is unusable, and is treated as blank.                                         |
| `Slack webhook request failed - verify webhook URL is correct:`        | Slack answered with an error. A revoked webhook gives 403 or 404.                           |
| `Slack webhook request timed out …`                                    | Slack was slow; the alert stays queued for the next run.                                    |
| `Slack outbox is full: dropped its oldest messages`                    | More than 500 alerts were waiting, typically because Slack was unreachable for a long time. |
| `Dropped a Slack message that was unreadable or queued over a day ago` | An alert waited a day undelivered, and was dropped.                                         |
| `Mod action by unknown moderator`                                      | An action by an account not on the mod list, sent as a security alert.                      |
| `Failed to fetch moderator list:`                                      | The mod list couldn't be read, so the action was treated as a moderator's.                  |
| `Failed to check modqueue:`                                            | A monitor run failed. The third in a row alerts the alert channel.                          |
| `Failed to load configuration - check settings format and values:`     | The settings couldn't be read, so the last settings read were used.                         |
| `Failed to check that the user moderates the subreddit; refusing:`     | A menu action was refused because Reddit couldn't confirm the user's permissions.           |

## Known limitations

- **Content in Slack isn't removed when it's deleted on Reddit.** Devvit's rules ask apps to delete content of deleted posts and comments from external services. This app keeps alerts as they were sent, a deliberate choice for a private moderation tool.
- **Ban and mute history is kept for 90 days**, longer than the 30 days Reddit recommends for user data, so that unbans after longer bans keep their context.
- **The monitor reads each listing in full.** Reddit's listings end at around a thousand items, so a run makes at most a few dozen requests.
- **Handler time limits.** Devvit doesn't document a time limit for Blocks handlers. The outbox keeps each run to about 10 seconds plus one request, and recovers a run that's cut off.
- **Blocks is deprecated.** Devvit 0.15 still supports the Blocks API the app is built on, but marks it deprecated. A later move to Devvit Web is expected.
