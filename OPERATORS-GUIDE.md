# Operators Guide

This guide is for the people who deploy Mod Action Notifications, configure it for a subreddit, and keep it running. It explains how the app works, how to deploy and upgrade it, what it stores, and how to troubleshoot it. The [README](./README.md) describes what the app does. [AGENTS.md](./AGENTS.md) covers the architecture and conventions for contributors.

## How it works

The app is a Devvit app. Reddit runs it, and it acts only when Reddit calls it:

```text
Mod action, post deleted ─┐
                          ├─► checks and context ─► alert ─► Slack outbox (Redis) ─► Slack app
Every 15 minutes ─────────┘                                         ▲
Post or comment deleted ─► its text leaves queued alerts ───────────┘
Mod tools menu ─► Test Slack Connection, Simulate Mod Action ─────────────────────► Slack app
```

| Reddit calls it for                              | It does                                                                                         |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| A mod action (`ModAction` trigger)               | Records the action's context, and sends an alert if your settings ask for one.                  |
| A deleted post (`PostDelete` trigger)            | Takes the post out of queued alerts, then alerts if a user deleted their own high-scoring post. |
| A deleted comment (`CommentDelete` trigger)      | Takes the comment out of queued alerts.                                                         |
| The `modqueueMonitor` job, every 15 minutes      | Checks the modqueue, unmoderated and reports listings against your thresholds.                  |
| The `slackOutbox` job, scheduled as needed       | Delivers alerts still waiting in the queue.                                                     |
| The `dailySummary` job, at 08:00 UTC each day    | Posts the summary of the day before, when the Daily Summary setting is on.                      |
| Install and upgrade (`AppInstall`, `AppUpgrade`) | Schedules or cancels the modqueue monitor to match your settings, and keeps the summary job.    |
| The mod tools menu                               | Runs the four menu actions, for moderators only.                                                |

## Deploying

### Requirements

- Node.js 22.13 or later, 24, or 26.
- A Reddit account that moderates the subreddit. The Devvit command-line tool comes with the project's dependencies.
- A Slack workspace where you can install an app. The app posts through a Slack app of your own, which [slack-app/](./slack-app/README.md) holds the template for.

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
npx devvit settings set slackBotToken  # the Slack app's bot token
```

The bot token comes from the Slack app: [slack-app/README.md](./slack-app/README.md) says how to create it, and how to add it to the alert channels. Then follow the [README's Getting started](./README.md#getting-started) to configure the app.

### Before the first release

- **Domain approval.** The app fetches `slack.com`, Slack's Web API. Reddit reviews requested domains when you first playtest or upload, and alerts can't reach Slack until it's approved.
- **Display name.** In the app's Developer Settings on developers.reddit.com, set the display name to Mod Action Notifications. The `name` in [devvit.json](./devvit.json), `ukpolitics-man`, is the app's Reddit account and URL slug: changing it would make a new app, without the installations or data of this one.
- **Legal links.** Apps that fetch external domains must link to their terms and privacy policy in the app's details form on developers.reddit.com. Use [TERMS-AND-CONDITIONS.md](./TERMS-AND-CONDITIONS.md) and [PRIVACY-POLICY.md](./PRIVACY-POLICY.md).

### Permissions

[devvit.json](./devvit.json) requests:

- **Reddit API:** reads the mod list, the mod log's bans, posts, the modqueue, unmoderated and reports listings, and the permissions of the user who opens a menu action. Its only write is a notice to the subreddit's modmail about a problem with the app (see [Reading the logs](#reading-the-logs)). The app never posts, removes or bans.
- **Redis:** the stores listed under [Data stored](#data-stored).
- **HTTP:** `slack.com` only, to post with Slack's `chat.postMessage`.
- **Triggers:** `onAppInstall`, `onAppUpgrade`, `onModAction`, `onPostDelete`, `onCommentDelete`.

### Upgrading

Upload a new version. Each installation then upgrades, and the `AppUpgrade` trigger runs monitor setup again, which leaves exactly one monitor job scheduled.

Data written by earlier versions is carried over as it's used:

- **Ban and mute records** kept under the earlier format (`mod_actions:discipline:*`) are moved to the current one the first time they're needed. The old key is then deleted. Records nobody needs expire within 90 days.
- **The monitor job ID** that earlier versions kept (`modqueue_monitor_job_id`) is deleted by setup. The scheduler itself now says which job runs.

**Rolling back.** If you go back to an earlier version, it can't read ban and mute records that were already moved. It also never delivers alerts left in the queue by this version.

### Uninstalling

Uninstalling removes the installation's settings and stored data. Reinstalling starts fresh.

## Configuration

The developer sets the Slack bot token, for every installation at once. Moderators set the rest under the app's settings for the subreddit. The stored names are permanent; renaming one would lose what installations have saved.

| Setting (stored name)                                                                             | Accepted values               | Effect                                                                                                       |
| ------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Slack Bot Token (`slackBotToken`)                                                                 | `xoxb-…`, or blank            | The Slack app's token, set with `npx devvit settings set slackBotToken`. Blank turns off every alert.        |
| Enabled Mod Actions (`enabledActions`)                                                            | any of 31 action types        | Which actions send an alert.                                                                                 |
| Excluded Moderators (`excludedModerators`)                                                        | usernames separated by commas | Their actions never send an alert. Names are matched ignoring case.                                          |
| Flag Unknown Moderators (`flagUnknownModerators`)                                                 | on or off                     | Actions by accounts not on the mod list become security alerts.                                              |
| Include Mod Note (`includeModNote`)                                                               | on or off                     | Shows the moderator's note. Reddit's events carry none, so notes appear on bans only, read from the mod log. |
| Notification Channel (`notificationChannel`)                                                      | a channel ID, or a name       | Channel for moderator and Reddit actions, and the summary. Blank turns off every alert.                      |
| Alert Channel (`alertChannel`)                                                                    | a channel ID, or a name       | Channel for security, modqueue and deleted-post alerts. Falls back to the notification channel.              |
| Modqueue Size Alert Threshold (`modqueueThreshold`)                                               | a whole number of 0 or more   | Alert when the modqueue holds at least this many items.                                                      |
| Unmoderated Content Age Alert (Hours) (`unmoderagedAgeHours`, spelt this way when it was created) | a whole number of 0 or more   | Alert when unreviewed content is at least this many hours old.                                               |
| Old Reported Content Alert (Hours) (`reportedContentAgeHours`)                                    | a whole number of 0 or more   | Alert when reported content is at least this many hours old.                                                 |
| Enable AutoModerator Slack Alerts (`enableAutoModAlerts`)                                         | on or off                     | Also alert for AutoModerator's actions.                                                                      |
| Post Deletion Alert Threshold (`postDeletionUpvoteThreshold`)                                     | a whole number of 0 or more   | Alert when a user deletes their own post with at least this score.                                           |
| Daily Summary (`dailySummary`)                                                                    | on or off                     | Posts a summary of the UTC day before at 08:00 UTC to the notification channel. Off by default.              |

A threshold of 0 turns its alert off. Turning all three modqueue thresholds off turns the monitor off once **Setup Modqueue Monitoring** runs.

**Saving.** The bot token must start `xoxb-`: a user token would post as the person who made it. The settings form rejects any threshold that isn't a whole number of 0 or more.

**Reading.**

- A value that still can't be used falls back to its default.
- If the settings can't be read at all, the app uses the last settings it read for that subreddit, logging the failure.

**Channels.** Name a channel by its ID (it starts with `C`, and is at the bottom of the channel's details), or a public channel by its name, with or without `#`. An ID keeps working when the channel is renamed, and a private channel needs one. The Slack app must be added to each channel.

**The bot token** is an app-wide secret: Devvit encrypts it, only the developer can set it, from the command line, and moderators never see it. Every installation uses it, so every subreddit the app is installed on posts to the one Slack workspace.

## Daily summary

With the Daily Summary setting on, the `dailySummary` job posts to the notification channel at 08:00 UTC. It covers the UTC day before:

- mod actions the app heard of;
- alerts delivered, dropped and redacted;
- modqueue monitor runs and failures;
- the problems in force as it is sent.

It goes through the outbox like any alert. It is also a heartbeat: if it stops arriving, Reddit has stopped calling the app, or the app can no longer reach Slack.

Setup (install, upgrade, or **Setup Modqueue Monitoring**) keeps one summary job scheduled whether the setting is on or off, as Devvit has no event for a change of settings; the job reads the setting each morning. Each day's summary is claimed in Redis, so a job that runs twice sends it once.

## Alerts in detail

### Mod action alerts

For each mod action, the app works through these steps. Steps 2 to 4 happen even for actions that send no alert, so the context is there when it's needed.

1. **Slack not set up?** Without a bot token or a notification channel nothing happens, and the health log notes which is missing (see [Reading the logs](#reading-the-logs)).
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

Slack takes about one message a second to a channel. Every alert therefore goes through the **outbox**, a queue in Redis, and is posted with Slack's `chat.postMessage`:

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
    - Slack refusing an alert (for example a revoked token, or a channel the Slack app isn't in) drops it.

    Drops are logged as health conditions, once when they start rather than once each.

- **What counts as taken.** Slack has taken an alert only when its answer says `ok`. It answers an error with its own code, such as `not_in_channel`. Rate limiting and failures of Slack's own (`ratelimited`, `internal_error`, `service_unavailable` and the like, or a 5xx) are retried; any other error code means Slack refuses the alert.
- **Possible duplicates.** Delivery is at least once. If Slack accepted a request but the answer was lost, or a run was cut off mid-request, the alert is sent again.
- **Deleted content.** An alert that quotes a post or comment, or links to one with a post's title in the link, is queued with a second version without them. Links in that version leave out only the title (`/comments/abc/_/def/`), so they still open the post or comment.
    - When Reddit reports a post or comment deleted, the app keeps its ID for a day and a second, longer than any alert can wait.
    - Queued alerts that quote it switch to their second version at once. If a run is delivering at that moment, it switches them before it finishes, and checks each alert again just before sending it.
    - An alert that arrives after the deletion is stored without the content.
    - This works whether or not Slack is set up, as alerts wait in the queue until it is.
    - The deleted-post alert is the exception: it exists to name the post it reports.
- **Content deleted after its alert was sent.** When Slack takes an alert that quotes a post or comment, the app remembers where it went (channel and timestamp) under each post and comment it quotes, with its second version, for 90 days.
    - When Reddit reports one of them deleted, each alert remembered for it gets a **redaction**: an edit (`chat.update`) that puts the second version in its place. Redactions wait in their own queue, and a run makes them once no alert is waiting, at the same pace.
    - Where the workspace's settings don't allow the edit (`edit_window_closed`, `cant_update_message`), the alert is deleted (`chat.delete`) instead. An alert already deleted in Slack (`message_not_found`) needs nothing.
    - Content deleted while its alert is on its way to Slack is redacted as soon as Slack has the alert.
    - Redactions count toward the day's `redacted`. One Slack refuses is dropped and reported as a health condition; one Slack can't take for now waits for a later run, as alerts do.
    - At most 50,000 posts and comments are remembered; past that, the oldest are forgotten first, so Redis stays well inside the 100 MB an unpublished app has. Set the alert channels' message retention to 90 days so that no alert outlives the record of where it is.
    - Alerts sent before this version, and alerts **Test Slack Connection** or **Simulate Mod Action** send, aren't remembered.

**Direct sends.** **Test Slack Connection** and **Simulate Mod Action** skip the queue, because a moderator is waiting for the answer. They retry after 1, 2 and 4 seconds before reporting failure.

## Data stored

**Redis.** All of this is per installation. Every key expires, or is cleared once it's used.

| Key                                                               | Holds                                                                                   | Kept for                          | Limit            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------- | ---------------- |
| `mod_actions:moderator_actions:{subreddit}:{moderator}`           | the moderator's recent action IDs, by time                                              | 1 hour                            | 100 actions      |
| `mod_actions:discipline_events:{ban\|mute}:{subreddit}:{user}`    | the user's bans or mutes and their lifting: time, moderator, note, details              | 90 days                           | 20 events        |
| `mod_actions:reported:{actionId}`                                 | that an action was alerted                                                              | 1 day                             | one per alert    |
| `post_deletion:alerted:{postId}`                                  | that a deletion was alerted                                                             | 1 day                             | one per alert    |
| `mod_actions:throttle:modqueue_{size\|unmoderated\|reported}`     | that an alert of that kind was sent                                                     | 1 hour                            | 3 keys           |
| `scheduler_failure_count`                                         | the monitor's failures in a row                                                         | 1 hour                            | 1 key            |
| `slack_outbox`                                                    | queued alerts, each with the IDs of the content it quotes and a version without it      | 1 day                             | 500 alerts       |
| `health:conditions`                                               | the health conditions in force, each with when it started                               | 7 days from when one was last met | 7 conditions     |
| `health:last`                                                     | when each event (a trigger, an alert delivered or dropped, a monitor run) last happened | 7 days from the last              | 7 events         |
| `health:count:{day}`                                              | how many of each event a UTC day saw                                                    | 8 days                            | 7 counts a day   |
| `health:summary:{day}`                                            | that the summary of a UTC day was sent                                                  | 2 days                            | 1 per day        |
| `health:notice:{condition}`                                       | that moderators were sent a notice of the condition within the day                      | 1 day                             | 1 per condition  |
| `health:noticed`                                                  | the conditions moderators were sent a notice of, so their end is sent                   | 7 days from the last              | 7 conditions     |
| `health:reminder:{condition}`                                     | that a condition was logged within the day                                              | 1 day                             | 1 per condition  |
| `slack_outbox_deleted`                                            | the IDs of posts and comments deleted on Reddit, by time                                | 1 day and 1 second                | one per deletion |
| `slack_outbox_sent:{contentId}`                                   | where each alert quoting the post or comment is in Slack, with its version without it   | 90 days from the last alert       | 50,000 in all    |
| `slack_outbox_sent`                                               | the posts and comments remembered, by when an alert last quoted each                    | 90 days from the last             | 50,000           |
| `slack_outbox_redactions`                                         | redactions waiting: where each alert is, and its version without quotes                 | 1 week                            | 5,000            |
| `slack_outbox_lease`                                              | which run is delivering                                                                 | 46.1 seconds                      | 1 key            |
| `slack_outbox_last_sent`                                          | when Slack was last sent a message                                                      | 1 minute                          | 1 key            |
| `slack_outbox_drain_scheduled`, `slack_outbox_recovery_scheduled` | that a follow-up or recovery run is scheduled                                           | until it runs                     | 1 key each       |

**Settings** are stored by Devvit for each installation, apart from the bot token, an encrypted app-wide secret that moderators can't read.

**Slack.** Alerts quote Reddit content: titles, and excerpts of up to 200 characters of removed posts and comments. Content deleted before an alert is sent leaves it; content deleted within 90 days after is taken out of it in Slack, by an edit or, failing that, by deleting the alert. The deleted-post alert keeps the title of the post it reports. Alerts stay in Slack under your workspace's message retention.

**Logs.** Devvit keeps the app's logs for 7 days, up to 5,000 entries. They record errors and never quote Reddit content; the one line that names an account is the one reporting an account not on the mod list. The bot token travels only in a request header, so no line names it.

## Access control

Reddit shows the four menu actions only to moderators, but Devvit runs a menu action's handler for whoever invokes it. So each menu action, and each form it opens, checks that the user has moderator permissions in the subreddit. If they don't, or if Reddit can't say, the action is refused with `🔒 Only this subreddit's moderators can use this.`

## Troubleshooting

### Show Bot Status

Moderators can't read the app's logs, so this is where they see how it's doing. It shows a form of read-only lines:

| Line                 | Says                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| App version          | The version installed.                                                                                                                         |
| Current problems     | Each health condition in force (see [Reading the logs](#reading-the-logs)), with what the app saw and for how long, and what to do; or `None`. |
| Alerts waiting       | How many alerts wait for Slack, and how long the oldest has waited.                                                                            |
| Last alert delivered | When Slack last took an alert, or `None in the last week`.                                                                                     |
| Slack app            | `Set up`, or what is missing: the bot token or the notification channel. Without both, no alerts are sent.                                     |
| Modqueue monitor     | `On, scheduled (cron …)`; `On, but not scheduled` (run **Setup Modqueue Monitoring**); `Off`, when all its thresholds are 0; or `Unknown`.     |
| Last monitor run     | When the monitor last ran, and whether it succeeded.                                                                                           |
| Last events          | When the app last heard of a mod action, a deleted post and a deleted comment. Nothing for a week suggests Reddit isn't calling the app.       |
| Today (UTC)          | Mod actions heard of, alerts delivered, dropped and redacted, and monitor runs and failures, since midnight UTC.                               |

A line reads `Unknown: Redis could not be read` when Redis fails; the rest still show.

### Test Slack Connection

| Result                                    | Meaning                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `🧪 Test alert sent!`                     | Slack accepted the message, in the notification channel.                                                                      |
| `⚠️ No Slack bot token is set.`           | The developer sets it: see [slack-app/README.md](./slack-app/README.md).                                                      |
| `⚠️ No Notification Channel is set.`      | Set it in the app's settings.                                                                                                 |
| `❌ Slack did not accept the test alert.` | Slack refused it or couldn't be reached. Check the channel, that the Slack app is in it, and the logs for Slack's error code. |

### Common problems

- **No alerts at all.**
    - Run **Test Slack Connection**.
    - Check the action types are enabled and the moderator isn't excluded.
    - Check AutoModerator alerts are on, if the actions are AutoModerator's.
- **Alerts in the wrong channel.** Without an alert channel, security, modqueue and deleted-post alerts go to the notification channel.
- **Slack is refusing alerts.** Show Bot Status gives Slack's error code. `not_in_channel`: add the Slack app to the channel. `channel_not_found`: check the channel ID, and that the Slack app is in a private channel. `is_archived`: the channel was archived. `invalid_auth`, `token_revoked` or `account_inactive`: the token needs replacing, as [slack-app/README.md](./slack-app/README.md#replacing-a-token-that-leaked) says.
- **Alerts arriving slowly during busy periods.** That's the 1.1-second pacing at work. A burst of 60 actions takes about a minute to deliver.
- **An alert sent twice.** This is rare: Slack accepted it but its answer was lost, so it was resent.
- **No modqueue alerts.**
    - Show Bot Status should say the monitor is on and scheduled.
    - The listing must reach the threshold.
    - Each kind of alert is held back for an hour after it's sent.
- **A deleted-post alert that never came.** Only deletions by the post's author count, and the score is the one Reddit reports at the moment of deletion.

### Reading the logs

Devvit keeps an installation's logs for 7 days, up to 5,000 entries, and only the app's developer can read them. A moderator can share read access with a developer from the app's installation settings. To read the last week, with each line's level and time:

```bash
npx devvit logs <your-subreddit> --since 7d --verbose
```

The command keeps following new lines until Ctrl+C. `--json` prints each line as JSON, for filtering with a tool such as `jq`. Without `--since`, it shows only lines logged from now on.

**Levels.**

- **ERROR**: an alert was lost, or a feature stopped working.
- **WARN**: an alert went out without something, or a moderator's menu action failed and they were told.
- **INFO**: the version installed or upgraded to, whether setup left the modqueue monitor on or off, and problems that have ended.

Each line starts with its area in brackets: `[health]`, `[setup]`, `[modaction]`, `[postdeletion]`, `[deletions]`, `[modqueue]`, `[outbox]`, `[slack]`, `[settings]` or `[menu]`. Lines never quote Reddit content, and never name the bot token.

**Health conditions.** A problem that lasts is a condition. It is logged once when it starts, once a day while it lasts (`Since <time>: …`), and once, at INFO, when it ends. This keeps it from filling the 5,000 entries.

| Condition                                        | Level | Starts when                                                                                                                                            | Ends when               | Modmail            |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ------------------ |
| No Slack bot token is set                        | WARN  | a mod action finds no bot token                                                                                                                        | a mod action finds one  | never              |
| No Slack channel is set                          | WARN  | a mod action finds no notification channel                                                                                                             | a mod action finds one  | never              |
| Slack is refusing alerts                         | ERROR | Slack refuses an alert with an error code, and it is dropped                                                                                           | Slack takes an alert    | at once            |
| Slack is not taking alerts                       | WARN  | a run leaves an alert queued after Slack failed or timed out                                                                                           | Slack takes an alert    | after half an hour |
| The alert queue is full                          | ERROR | a new alert pushes the oldest of 500 out                                                                                                               | a run empties the queue | at once            |
| Alerts are dropped after waiting a day           | ERROR | a run drops an alert queued over a day ago                                                                                                             | a run empties the queue | at once            |
| Deleted content is not being taken out of alerts | ERROR | Slack refuses a redaction, or one is dropped unmade (unreadable, a week old, more than 5,000 waiting, or Redis could not remember where an alert went) | a redaction is made     | never              |
| The modqueue monitor is failing                  | ERROR | a monitor run fails                                                                                                                                    | a monitor run succeeds  | after half an hour |

**Modmail notices.** Slack may be the very thing that is broken, so a condition moderators must act on also goes to the subreddit's modmail, as a notification from the app's account (in modmail's Notifications). The Modmail column says when. A notice gives the problem, what the app saw, what to do and when it started. Each condition is sent at most once a day, so a problem that comes and goes doesn't flood modmail, and again each day it lasts. Its end is sent too, when its start was. A notice modmail can't take (for example if the app's account is banned) is logged as `[health] Could not send moderators a modmail notice:`.

Lines that need attention besides those:

| Line                                                        | Meaning                                                                                       |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `[deletions] Could not take a deleted post or comment …`    | Redis failed as content was deleted. Alerts already queued may be sent quoting it.            |
| `[settings] Could not read the settings, so no alerts …`    | The settings couldn't be read, and none had been before in this app process: nothing is sent. |
| `[setup] Could not set up the modqueue monitor …`           | Scheduling failed. Use **Setup Modqueue Monitoring** to try again.                            |
| `[postdeletion] Could not check a deleted post:`            | Reddit couldn't return the post's score, so no deleted-post alert was considered.             |
| `[outbox] Could not deliver the queued alerts …`            | Redis failed during a run; the alerts wait for the next one.                                  |
| `[modaction] An account not on the mod list took an action` | Sent as a security alert.                                                                     |
| `[health] Could not record a condition:`                    | Redis failed while noting a problem; the work went on, and the problem may be logged again.   |

## Known limitations

- **Deleted content is taken out of alerts for 90 days.** Devvit's rules ask apps to delete content of deleted posts and comments from external services. The app does, in alerts not yet sent and in alerts Slack has held for up to 90 days (or, with heavy traffic, until 50,000 newer posts and comments have been quoted). An alert older than that keeps its quotes, unless the channel's retention has removed it. The deleted-post alert names the post it reports, by the owner's choice.
- **Deleted accounts.** Reddit doesn't tell apps when an account is deleted, so usernames stay in alerts in Slack, and in the ban and mute history until it expires.
- **Ban and mute history is kept for 90 days**, longer than the 30 days Reddit recommends for user data, so that unbans after longer bans keep their context.
- **The monitor reads each listing in full.** Reddit's listings end at around a thousand items, so a run makes at most a few dozen requests.
- **Handler time limits.** Devvit doesn't document a time limit for Blocks handlers. The outbox keeps each run to about 10 seconds plus one request, and recovers a run that's cut off.
- **Blocks is deprecated.** Devvit 0.15 still supports the Blocks API the app is built on, but marks it deprecated. A later move to Devvit Web is expected.
