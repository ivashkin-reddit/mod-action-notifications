# Operators Guide

This guide is for the people who deploy Mod Action Notifications, configure it for a subreddit, and keep it running. It explains how the app works, how to deploy and upgrade it, what it stores, and how to troubleshoot it. The [README](./README.md) describes what the app does. [AGENTS.md](./AGENTS.md) covers the architecture and conventions for contributors.

## How it works

The app is a Devvit app. Reddit runs it, and it acts only when Reddit calls it:

```text
Mod action, edit, report, modmail, deletion ─┐
                                             ├─► checks and context ─► alert ─► Slack outbox (Redis) ─► Slack app
Every 15 minutes, daily, weekly ─────────────┘                                         ▲
Post or comment deleted ─► its text leaves queued alerts ──────────────────────────────┘
Mod tools menu ─► Connect Slack, Test Slack Connection, Simulate Mod Action ──────────────────────────► Slack app
```

| Reddit calls it for                                                                                         | It does                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A mod action (`ModAction` trigger)                                                                          | Records the action's context, and sends an alert if your settings ask for one; a removal at the spike rate joins its account's burst instead. |
| A deleted post (`PostDelete` trigger)                                                                       | Takes the post out of queued alerts, then alerts if a user deleted their own high-scoring post.                                               |
| A deleted comment (`CommentDelete` trigger)                                                                 | Takes the comment out of queued alerts.                                                                                                       |
| A report (`PostReport`, `CommentReport` triggers)                                                           | Notes the item as waiting for a moderator, then alerts on an urgent reason, or on reports piling up.                                          |
| A modmail message (`ModMail` trigger)                                                                       | Counts it toward the team's reply times, then alerts when a Reddit admin wrote it.                                                            |
| AutoModerator holding an item for review (`AutomoderatorFilterPost`, `AutomoderatorFilterComment` triggers) | Notes the item as waiting for a moderator.                                                                                                    |
| An edit (`PostUpdate`, `CommentUpdate` triggers)                                                            | Alerts when an author edits a post or comment a moderator approved lately.                                                                    |
| The `modqueueMonitor` job, every 15 minutes                                                                 | Checks the modqueue, unmoderated, reports, spam and edited listings, and modmail waiting for a reply, against your thresholds.                |
| The `slackOutbox` job, scheduled as needed                                                                  | Delivers alerts still waiting in the queues.                                                                                                  |
| The `removalBurst` job, scheduled as needed                                                                 | Sends a burst of removals' summary: its running totals every five minutes while it lasts, and its total once it ends.                         |
| The `dailySummary` job, at 08:00 UTC each day                                                               | Posts the summary of the day before, when the Daily Summary setting is on.                                                                    |
| The `weeklyStatistics` job, at 08:00 UTC each Monday                                                        | Posts the team's statistics for the week before, when the Weekly Statistics setting is on.                                                    |
| Install and upgrade (`AppInstall`, `AppUpgrade`)                                                            | Schedules or cancels the modqueue monitor to match your settings, and keeps the summary and statistics jobs.                                  |
| The mod tools menu                                                                                          | Runs the six menu actions, for moderators only.                                                                                               |

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
```

Each subreddit posts to its own Slack workspace: [slack-app/README.md](./slack-app/README.md) says how its moderators create the Slack app, add it to the alert channels, and connect it with **Connect Slack**. Then follow the [README's Getting started](./README.md#getting-started) to configure the app. Before a release, try each feature on a test subreddit as [docs/playtest-runbook.md](./docs/playtest-runbook.md) sets out.

### Before the first release

- **Domain approval.** The app fetches `slack.com`, Slack's Web API. Reddit reviews requested domains when you first playtest or upload, and alerts can't reach Slack until it's approved.
- **Display name.** In the app's Developer Settings on developers.reddit.com, set the display name to Mod Action Notifications. The `name` in [devvit.json](./devvit.json), `ukpolitics-man`, is the app's Reddit account and URL slug: changing it would make a new app, without the installations or data of this one.
- **Legal links.** Apps that fetch external domains must link to their terms and privacy policy in the app's details form on developers.reddit.com. Use [TERMS-AND-CONDITIONS.md](./TERMS-AND-CONDITIONS.md) and [PRIVACY-POLICY.md](./PRIVACY-POLICY.md).

### Permissions

[devvit.json](./devvit.json) requests:

- **Reddit API:** reads the mod list, the mod log's bans, users' mod notes (their kinds and dates), posts, the modqueue, unmoderated, reports, spam and edited listings, modmail conversations, AutoModerator's config page and its revisions, and the permissions of the user who opens a menu action. Its only write is a notice to the subreddit's modmail about a problem with the app (see [Reading the logs](#reading-the-logs)). The app never posts, removes or bans.
- **Redis:** the stores listed under [Data stored](#data-stored).
- **HTTP:** `slack.com` only, to post with Slack's `chat.postMessage`.
- **Triggers:** `onAppInstall`, `onAppUpgrade`, `onModAction`, `onPostDelete`, `onCommentDelete`, `onPostReport`, `onCommentReport`, `onPostUpdate`, `onCommentUpdate`, `onModMail`, `onAutomoderatorFilterPost` and `onAutomoderatorFilterComment`.

### Upgrading

Upload a new version. Each installation then upgrades, and the `AppUpgrade` trigger runs monitor setup again, which leaves exactly one monitor job scheduled.

Data written by earlier versions is carried over as it's used:

- **The Slack bot token.** Earlier versions read it from the app-wide `slackBotToken` secret, set by the developer. This version reads only the connection each subreddit makes with **Connect Slack**. After the upgrade, a moderator connects once; until then no alerts are sent, and **Show Bot Status** says Slack isn't connected. The old secret is no longer read.
- **Ban and mute records** kept under the earlier format (`mod_actions:discipline:*`) are moved to the current one the first time they're needed, without the mod note they held. The old key is then deleted. Records nobody needs expire within 90 days.
- **Ban and mute records** written before mod notes were left out of them still hold the note. Nothing reads it, and it expires with the record, within 90 days.
- **The monitor job ID** that earlier versions kept (`modqueue_monitor_job_id`) is deleted by setup. The scheduler itself now says which job runs.
- **Where alerts are in Slack**, as earlier versions kept it (a hash for each post and comment, `slack_outbox_sent:{contentId}`, and `slack_outbox_sent`), is still read when its post or comment is deleted, and redacted as before; it is then deleted. Nothing is added to it, and the rest expires within 90 days.

**Rolling back.** If you go back to an earlier version, it can't read ban and mute records that were already moved. It also never delivers alerts left in the queue by this version, and can't redact alerts this version sent.

### Uninstalling

Uninstalling removes the installation's settings and stored data. Reinstalling starts fresh.

## Configuration

Moderators set these under the app's settings for the subreddit, and connect Slack with **Connect Slack**. The stored names are permanent; renaming one would lose what installations have saved.

| Setting (stored name)                                                                             | Accepted values                            | Effect                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Enabled Mod Actions (`enabledActions`)                                                            | any of 43 action types                     | Which actions send an alert.                                                                                                                                                                                                                          |
| Excluded Moderators (`excludedModerators`)                                                        | usernames separated by commas              | Their actions never send an alert. Names are matched ignoring case.                                                                                                                                                                                   |
| Flag Unknown Moderators (`flagUnknownModerators`)                                                 | on or off                                  | An alerted action by an account not on the mod list becomes a security alert. The mod list is reused for five minutes, and fetched again for a name it lacks, so a new moderator isn't flagged.                                                       |
| Security Alerts (`securityAlerts`)                                                                | on or off                                  | Sends the security actions (`addmoderator`, `removemoderator`, `invitemoderator`, `acceptmoderatorinvite`, `setpermissions`, `dev_platform_app_*`) as security alerts to the alert channel, whatever Enabled Mod Actions and Excluded Moderators say. |
| Dormant Moderator Alert (Days) (`dormantModeratorDays`)                                           | a whole number from 0 to 365               | A moderator's first action after at least this many days is a security alert. 0 turns it off.                                                                                                                                                         |
| Include Mod Note (`includeModNote`)                                                               | on or off                                  | Shows the moderator's note. Reddit's events carry none, so notes appear on bans only, read from the mod log.                                                                                                                                          |
| Ban Alert History (Days) (`banHistoryDays`)                                                       | a whole number of 0 or more                | How many days before a ban its alert counts the user's mod notes, by kind. 0 leaves the history out, and the notes unread.                                                                                                                            |
| Notification Channel (`notificationChannel`)                                                      | a channel ID, or a name                    | Channel for moderator and Reddit actions, and the summary. Blank turns off every alert.                                                                                                                                                               |
| Alert Channel (`alertChannel`)                                                                    | a channel ID, or a name                    | Channel for security, modqueue and deleted-post alerts. Falls back to the notification channel.                                                                                                                                                       |
| Slack Message Retention (Days) (`slackRetentionDays`)                                             | a whole number from 1 to 90; 90 by default | How many days the alert channels keep messages. The app remembers where each alert quoting a post or comment is for that long, to redact it if the content is deleted. Set it to the channels' retention in Slack.                                    |
| Modqueue Size Alert Threshold (`modqueueThreshold`)                                               | a whole number of 0 or more                | Alert when the modqueue holds at least this many items.                                                                                                                                                                                               |
| Unmoderated Content Age Alert (Hours) (`unmoderagedAgeHours`, spelt this way when it was created) | a whole number of 0 or more                | Alert when unreviewed content is at least this many hours old.                                                                                                                                                                                        |
| Old Reported Content Alert (Hours) (`reportedContentAgeHours`)                                    | a whole number of 0 or more                | Alert when reported content is at least this many hours old.                                                                                                                                                                                          |
| Spam Queue Size Alert Threshold (`spamQueueThreshold`)                                            | a whole number of 0 or more                | Alert when Reddit's spam queue holds at least this many items.                                                                                                                                                                                        |
| Edited Queue Size Alert Threshold (`editedQueueThreshold`)                                        | a whole number of 0 or more                | Alert when Reddit's edited queue, of recently edited posts and comments, holds at least this many items.                                                                                                                                              |
| Modmail Waiting Alert (Hours) (`modmailWaitHours`)                                                | a whole number of 0 or more                | Alert, at most every six hours, when a user has waited this many hours for a reply in the New, In Progress or Appeals folder. 24 by default; 0 turns it off. Keeps the monitor scheduled.                                                             |
| Urgent Report Reasons (`urgentReportReasons`)                                                     | reasons separated by commas                | A report whose reason contains one, ignoring case, alerts the alert channel at once.                                                                                                                                                                  |
| Report Pile-Up Alert Threshold (`reportPileUpThreshold`)                                          | a whole number of 0 or more                | A post or comment reaching this many reports alerts once.                                                                                                                                                                                             |
| Admin Modmail Alerts (`adminModmailAlerts`)                                                       | on or off                                  | A Reddit admin's message in modmail alerts the alert channel at once.                                                                                                                                                                                 |
| Edits After Approval Alert (Days) (`editsAfterApprovalDays`)                                      | a whole number from 0 to 30                | An author's edit within this many days of a moderator's approval alerts the alert channel, once a day for an item. 0 turns it off, and no approvals are kept.                                                                                         |
| Enable AutoModerator Slack Alerts (`enableAutoModAlerts`)                                         | on or off                                  | Also alert for AutoModerator's actions.                                                                                                                                                                                                               |
| Post Deletion Alert Threshold (`postDeletionUpvoteThreshold`)                                     | a whole number of 0 or more                | Alert when a user deletes their own post with at least this score.                                                                                                                                                                                    |
| Daily Summary (`dailySummary`)                                                                    | on or off                                  | Posts a summary of the UTC day before at 08:00 UTC to the notification channel. Off by default.                                                                                                                                                       |
| Weekly Statistics (`weeklyStatistics`)                                                            | on or off                                  | Posts the team's statistics for the week before each Monday at 08:00 UTC. Off by default.                                                                                                                                                             |
| Debug Logging (`debugLogging`)                                                                    | on or off                                  | Logs a completion line for every invocation (see [Reading the logs](#reading-the-logs)), not only for failed and slow ones. For an incident: Devvit keeps 5,000 lines. Off by default                                                                 |

A threshold of 0 turns its alert off. Turning all three modqueue thresholds off turns the monitor off once **Setup Modqueue Monitoring** runs.

**Saving.** The settings form rejects any threshold that isn't a whole number of 0 or more.

**Reading.**

- A value that still can't be used falls back to its default.
- If the settings can't be read at all, the app uses the last settings it read for that subreddit, logging the failure.

**Channels.** Name a channel by its ID (it starts with `C`, and is at the bottom of the channel's details), or a public channel by its name, with or without `#`. An ID keeps working when the channel is renamed, and a private channel needs one. The Slack app must be added to each channel.

**The Slack connection.** Each subreddit posts to its own workspace, through a Slack app its moderators made from [slack-app/manifest.json](./slack-app/manifest.json).

- **Connect Slack** takes that app's bot token. It must start `xoxb-`: a user token would post as the person who made it.
- The app asks Slack whose the token is (`auth.test`), and posts a message to the Notification Channel and the Alert Channel. Only when Slack takes all of them does it keep the token, with the workspace's name (`slack_connection`), in place of any before it, and start a run of the outbox.
- No form, log line or message shows the token again: it goes only into a request's authorization header. Devvit has no secret per installation, so it is kept in the installation's Redis.
- Leaving the token empty disconnects Slack. No alerts are sent until it is connected again; what was already queued waits for it.

## Daily summary

With the Daily Summary setting on, the `dailySummary` job posts to the notification channel at 08:00 UTC. It covers the UTC day before:

- mod actions the app heard of;
- alerts delivered, dropped and redacted;
- modqueue monitor runs and failures;
- the problems in force as it is sent.

It goes through the outbox like any alert. It is also a heartbeat: if it stops arriving, Reddit has stopped calling the app, or the app can no longer reach Slack.

Setup (install, upgrade, or **Setup Modqueue Monitoring**) keeps one summary job scheduled whether the setting is on or off, as Devvit has no event for a change of settings; the job reads the setting each morning. Each day's summary is claimed in Redis, so a job that runs twice sends it once.

## Report alerts

The `PostReport` and `CommentReport` triggers tell the app of each report, with its reason and the item's reports so far. While Slack is set up:

- **Urgent reasons.** A report whose reason contains one of the Urgent Report Reasons, ignoring case, alerts the alert channel at once: `🚨 Urgent report`, naming the reason as configured, with a link to the item (without a post's title) and its reports so far. A reason a reporter typed is never shown, as it is text a user wrote.
- **Pile-ups.** A post or comment reaching the Report Pile-Up Alert Threshold alerts once: `📣 Reports piling up`. Posts whose reports moderators chose to ignore are skipped; Devvit doesn't say so of comments.
- **Once a day.** Each alert is claimed by the item's ID for a day (`reports:urgent:{itemId}`, `reports:pileup:{itemId}`), so a second report of the same item, or an event delivered twice, sends nothing more. A claim that can't be stored still sends.

## Modmail alerts

- **From Reddit's admins.** The `ModMail` trigger tells the app of each modmail message. For a message written as a user, rather than by a moderator writing as one, the app reads its conversation (without marking it read). When the message's author is a Reddit admin, `🛡️ Modmail from a Reddit admin` goes to the alert channel at once, with the admin's username, the conversation's subject (escaped) and a link to it. Each message is claimed for a day (`modmail:admin:{messageId}`), so one delivered twice alerts once; a claim that can't be stored still sends. The event's IDs may carry the prefixes `ModmailConversation_` and `ModmailMessage_`; the app takes them off.
- **Waiting for a reply.** While Modmail Waiting Alert (Hours) is above 0 (it is 24 by default), each monitor run lists the New, In Progress and Appeals folders, up to 100 conversations each. A user waits when they wrote after a moderator last acted in the conversation; conversations AutoModerator or Reddit generated are left out, and so are those Reddit marks archived, whichever folder lists them. When any user has waited the configured hours since they last wrote, `📬 Modmail waiting for a reply` goes to the alert channel: how many conversations, how many of them are ban appeals, and the longest wait, with links to the three folders. It is sent at most every six hours (`modmail:throttle:waiting`). When a folder holds 100 or more, the alert says "at least".
- **Failures.** A modmail read that fails raises the condition _Modmail cannot be read_ until one succeeds (see [Reading the logs](#reading-the-logs)). It leaves the modqueue's checks, and the monitor's own health, alone.

## Edits after approval

- **Approvals.** A moderator's `approvelink` or `approvecomment`, from the `ModAction` trigger, is remembered for the configured days (`approved_edits:approved:{itemId}`: who approved it, and when), whether or not Slack is set up. A later approval replaces an earlier one. AutoModerator's and Reddit's approvals aren't kept, nor any while the setting is 0.
- **Edits.** The `PostUpdate` and `CommentUpdate` triggers tell the app of each update. Only its author can edit a post or comment, so an update whose text differs from the text before is the author's edit; Reddit also sends updates that leave the text alone, which are skipped. The app compares the two versions and keeps neither. An edit within the configured days of a remembered approval sends `✏️ Edited after approval` to the alert channel: the author, who approved it and how long before, and a link without the post's title. Each item alerts at most once a day (`approved_edits:alerted:{itemId}`).

## Security watch

While **Security Alerts** is on, the app watches every mod action for three more signs of a compromised account or a broken tool, each sent as a security alert to the alert channel:

- **A moderator wakes.** The app keeps when each moderator last acted (`security:last_action`). A moderator's first action after at least Dormant Moderator Alert days alerts once a day. A moderator the app has not seen act since install is not alerted on; removing a moderator forgets them. AutoModerator and Reddit's accounts are not tracked. A late, older action never moves a moderator's time back.
- **AutoModerator's config is edited.** On a `wikirevise` action, the app reads the latest two revisions of `config/automoderator`. If the latest is the acting moderator's, made within two minutes of the action, it alerts with the revision's reason and how many lines were added and removed, and links to the page's revisions. The config's text is read to count lines; it is never sent or kept. The edit is noted for a day (`security:automod_edit`).
- **AutoModerator misfires.** The app counts AutoModerator's removals by minute, for two days. In the hour after a noted edit, at least 20 removals, and at least five times AutoModerator's hourly average over the day before, alert once per edit.

If the wiki can't be read, the edit isn't checked, and the log says so.

## Team statistics

The app counts every mod action it hears of, whether or not Slack is set up and whether or not the action alerts, once by its ID. It keeps counts by UTC day for 15 days, never by moderator:

- actions, by who took them (moderators, AutoModerator, or Reddit's own accounts) and their type;
- moderators' actions by UTC hour;
- bans, as temporary (with their days) or permanent when the mod log gives their length, and unbans;
- removals on each thread, up to 10,000 threads a day;
- how many moderators acted, as a set of 8-hex-digit hashes of their names, each with when that moderator last acted that day. The hash keeps names out of the statistics; it is no secret, as hashing the names on the mod list would match them.

**Show Team Stats** reports the last 7 days, today included, and today's actions. The **Weekly Statistics** setting has the `weeklyStatistics` job post the week Monday to Sunday each Monday at 08:00 UTC, beside the week before's total. Setup keeps one such job scheduled whether the setting is on or off, as for the daily summary, and each week's digest is claimed in Redis, so a job that runs twice sends it once.

"Hours without a moderator action" counts each UTC hour of the period, today's up to and including the current one, in which no moderator acted. "Most-moderated threads" links to posts by ID, without their titles.

**How the team responds.** Both reports also give, from `stats:outcomes:{day}`:

- **Time to act on the queue.** A post or comment starts waiting at its first report, or when AutoModerator holds it for review (the `AutomoderatorFilterPost` and `AutomoderatorFilterComment` triggers): `stats:awaiting` keeps its ID, since when, and which, the first entry winning (`HSETNX`). It stops at the first removal, spam removal or approval by anyone; a moderator's is counted, on the day they acted, in a range (within 15 minutes, an hour, 4, 12 or 24 hours, or longer), and the report gives the range the median falls in. The handler whose `HDEL` removes the entry counts it, so two moderators acting at once count it once.
- **Reported items** and **Filtered by AutoModerator.** How many of each kind moderators removed and approved, with their shares. Approvals of filtered items are AutoModerator's false positives. They are not broken down by rule: a rule's reason can quote what it matched, which would put content into the statistics.
- **Removals reversed.** Every removal by Reddit or a moderator is noted for two days in `stats:removed:{day}` (the item's ID, and `reddit` or the moderator's hash). A moderator's approval of one of those, from the same day or the day before, counts as reversing Reddit's removal, or another moderator's; approving their own removal counts as neither.
- **Modmail replies.** A user's message starts a wait in `stats:modmail_waiting` (the conversation's ID, and since when), unless one has already started; the first moderator reply after it ends the wait and counts it in a range, as for the queue. Messages AutoModerator or Reddit generated start none. Time archived isn't reply time: a message in an archived conversation, the event's `conversationState`, starts no wait and ends one without counting it.

Items and conversations that wait over a week are forgotten when the `weeklyStatistics` job runs, whatever the setting, and the oldest when more than 10,000 wait.

## Alerts in detail

### Mod action alerts

For each mod action, the app works through these steps. Steps 2 to 4 happen even for actions that send no alert, so the context is there when it's needed.

1. **Slack not set up?** Without Slack connected or a notification channel nothing happens, and the health log notes which is missing (see [Reading the logs](#reading-the-logs)).
2. **Ban length.** For a ban that doesn't say how long it lasts, the app reads the mod log's 10 most recent bans and takes the matching entry. It tries the entry with the action's own ID first, then one for the same user by the same moderator, then one by the same moderator, and last one within two minutes of the action.
3. **Ban and mute history.** Each ban, unban, mute and unmute is recorded as moderation metadata: who acted, on whom, when, and its details (for a ban, its length), never the mod note. Records are kept for 90 days, the latest 20 per user. Only unban and unmute alerts read them, so bans and unbans are recorded only while unban alerts are on, and mutes and unmutes only while unmute alerts are on. An unban or unmute alert names the latest ban or mute taken before it. This works even when Reddit delivers the events out of order.
4. **Activity.** Each action counts toward its account's activity by the time it was taken: a moderator's, or one of Reddit's accounts', but not AutoModerator's. An account's fifth action within a minute is a spike. A moderator's alert says so; Reddit's accounts' count only toward bursts.
5. **Should it alert?** A security action always alerts while Security Alerts is on, as a security alert to the alert channel. Otherwise, only if the action's type is enabled, its moderator isn't excluded, and it isn't AutoModerator's while AutoModerator alerts are off.
6. **Who acted.**
    - An action by u/reddit or Anti-Evil Operations is a Reddit action.
    - Otherwise, with Flag Unknown Moderators on, the app checks the mod list, reusing it for five minutes per subreddit.
    - An account not on the list makes a security alert. If the mod list can't be read, the action is treated as a moderator's.
7. **Once per action.** The action's ID is claimed for a day, so an event Reddit delivers again sends no second alert, and is counted in a burst once.
8. **Bursts.** A removal at the spike rate, by a moderator or one of Reddit's accounts, joins its account's burst. The first is alerted, saying further removals will be summarised; the rest are counted, not sent. See [Removal bursts](#removal-bursts).
9. **Ban history.** For a ban that alerts, the app reads up to 100 of the user's entries in Reddit's mod notes and counts, by kind, those from the Ban Alert History days before the ban. The ban's own note, made in the same second, is left out. If the notes can't be read, the ban alerts without them.
10. **Queued** for Slack: in the alert queue for the alert channel, otherwise in the notification queue.

**Alert content.** An alert names:

- the action, the moderator, and the user acted on. A moderator is linked to their profile; u/reddit and Anti-Evil Operations are named in plain text, as a Reddit account, since they stand for Reddit and Anti-Evil Operations has no profile. The same goes for who issued the ban an unban alert recalls, and for burst lines and summaries;
- a link to the content and a quote of up to 200 characters;
- when the action was taken (UTC);
- for bans, the length, any details, the mod note if enabled, and the user's mod-note history over Ban Alert History days, as counts by kind;
- for unbans and unmutes, the ban or mute lifted: who issued it, when, and its details (the length), never its note;
- a status line for unknown moderators, AutoModerator, Reddit's accounts and a moderator's activity spike;
- for the removal that opens a burst, a line saying further removals will be summarised.

Text from Reddit is escaped, so text such as `<!channel>` in a post shows as written and notifies no one.

**Channels.** Security alerts, and actions by accounts not on the mod list, go to the alert channel. Moderator and Reddit actions, and burst summaries, go to the notification channel.

### Removal bursts

A moderator clearing the queue in bulk, or removing a brigaded thread, takes hundreds of actions in minutes. Sent one by one, those alerts would fill Slack, and hold up the queue, for many minutes. So once an account removes at the spike rate, its removals are summarised:

- **What joins.** A removal (`removelink`, `removecomment`, `spamlink`, `spamcomment`) that would alert, by a moderator or by u/reddit or Anti-Evil Operations, once its account has taken five or more actions within a minute. Bans, other actions, AutoModerator's removals, and removals by accounts not on the mod list (security alerts) are never held.
- **The opening removal** is alerted as before, with one more line: _Further removals by u/… will be summarised_.
- **Later removals** are counted, not sent, in the account's burst record: counts by type, when the burst opened, and when its latest removal came.
- **Summaries** go to the notification channel:
    - every five minutes while the burst lasts, with its running totals (_still going_);
    - its total, a minute after its last removal.

    Each gives the comments and posts removed, how many were spam, when, and a link to the mod log. For a moderator the link is filtered to them (`old.reddit.com/r/{subreddit}/about/log/?mod={name}`); for Reddit's accounts it is the whole log. The count starts at the removal that opened the burst. A burst with nothing after its opener sends no summary.

- **Then it ends.** The account's next removal is alerted on its own, until another spike.

How it works:

- **Joining.** Each removal joins in one Redis transaction: open the burst if none is, count the removal, note the time, and read back when the burst opened and when its summary is due. So concurrent removals each count once, and none is lost to a summary closing the burst.
- **The `removalBurst` job.** The removal that opens a burst schedules it for a minute later. Each run reschedules it for a minute after the latest removal, or for the next progress summary, until the burst has been quiet for a minute. Then the run renames the burst out of the way, reads it, deletes it and sends the total.
- **One run at a time.** Each run claims its due time, so a run delivered twice sends once. A run does nothing if a later run or a rescue has taken over.
- **When something fails.**
    - A removal that can't be counted is alerted on its own.
    - A burst whose summary can't be scheduled is forgotten, so its removals are alerted one by one.
    - A run that can't schedule the next closes the burst at once, with its total.
    - A removal that finds the summary over a minute overdue (its job lost) schedules it again. Only one removal does so.

### Deleted-post alerts

These cover only posts deleted by their own author, not removals by moderators or admins.

- **Score.** The app reads the post's score from Reddit at the moment of deletion, because votes fire no event the app could track. It alerts when the score reaches the threshold.
- **Content.** The alert gives the score, Reddit's deletion reason, the subreddit, when it was deleted, and a link to the post without its title (`/r/sub/comments/abc/`), which Reddit still opens. It leaves out the title and author: Devvit's rules ask apps to delete a deleted post's content from external services, and Reddit no longer shows the author. The app doesn't read either.
- **Channel.** It goes to the alert channel.
- **Once per post.** The post's ID is claimed for a day, so one deletion sends one alert.

### Modqueue monitor

The monitor runs every 15 minutes while any of its thresholds, or Modmail Waiting Alert (Hours), is above 0 and **Setup Modqueue Monitoring** has run. Each run also checks modmail waiting for a reply (see [Modmail alerts](#modmail-alerts)). Install and upgrade run setup automatically.

- **What it reads.** Each run reads only the listings whose alerts are on: the modqueue, Reddit's unmoderated listing, the reports listing, the spam queue and the edited queue.
- **The alerts:**
    - `⚠️ Modqueue Alert: N items pending`, with a count of posts and comments, when the modqueue reaches its threshold.
    - `⚠️ Spam Queue Alert: N items pending` and `⚠️ Edited Queue Alert: N items pending`, the same for the spam and edited queues.
    - `⏰ Unmoderated Content Alert` when content has waited past its age.
    - `📣 Old Reported Content Alert` when reported content has passed its age.

    The two age alerts list the five oldest items.

- **Throttling.** Each kind of alert is sent at most once an hour.
- **Failures.**
    - Every failed run is counted. The count is forgotten an hour after the last failure, and cleared by a run that succeeds.
    - The third failure in a row sends `⚠️ Critical: Modqueue Monitoring Failed N Times` to the alert channel.

## Delivery to Slack

Slack takes about one message a second to a channel. Every alert therefore goes through the **outbox**, two queues in Redis, and is posted with Slack's `chat.postMessage`:

- **Two queues.** This holds even when both settings name the same channel.
    - The **alert queue** holds what goes to the alert channel: security alerts, accounts not on the mod list, Reddit admins' modmail and modmail waiting, urgent reports and pile-ups, queue and monitor alerts, deleted posts, and edits after approval.
    - The **notification queue** holds what goes to the notification channel: mod actions, burst summaries, the daily summary and the weekly statistics.
- **Ordering.** One delivery run works the queues at a time: every waiting alert, oldest first, then the notifications, oldest first. So a backlog of mod actions never holds up a security alert. Each run holds a lease that lasts 46.1 seconds.
- **Pacing.**
    - Messages go out at least 1.1 seconds apart, including across runs. A run reads when the last one sent.
    - When Slack sends a Retry-After, the run waits as long as it asks.
- **Retries.** A request that fails is retried after 1, 2 and 4 seconds, at most three times in one run.
- **Run length.**
    - A run delivers for up to 10 seconds. A follow-up run, scheduled a second later, delivers the rest.
    - While Slack keeps failing, the queue waits 30 seconds, or as long as Slack asked, before the next run.
- **Recovery.** If a run is cut off by Reddit's time limit, for instance during a slow Slack request, a recovery run after its lease expires delivers what it left.
- **Limits.**
    - Each queue holds at most 500 messages; beyond that its oldest are dropped, so a flood of notifications never pushes out an alert.
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
- **Content deleted after its alert was sent.** When Slack takes an alert that quotes a post or comment, the app remembers where it went (channel and timestamp) under each post and comment it quotes, with its second version (without the quote, the title or any mod note), for as many days from when it was sent as **Slack Message Retention** (`slackRetentionDays`) says: 90 by default, and at most.
    - When Reddit reports one of them deleted, each alert remembered for it gets a **redaction**: an edit (`chat.update`) that puts the second version in its place. Redactions wait in their own queue, and a run makes them once no alert is waiting, at the same pace.
    - Where the workspace's settings don't allow the edit (`edit_window_closed`, `cant_update_message`), the alert is deleted (`chat.delete`) instead. An alert already deleted in Slack (`message_not_found`) needs nothing.
    - Content deleted while its alert is on its way to Slack is redacted as soon as Slack has the alert.
    - Redactions count toward the day's `redacted`. One Slack refuses is dropped and reported as a health condition; one Slack can't take for now waits for a later run, as alerts do.
    - Each alert is remembered on its own. Its second version expires when the retention since it was sent has passed, even if its post is quoted again later. The entries that name the alert under each post and comment it quotes go with the next alert sent after that, and all of them at most that many days after the last alert. Set **Slack Message Retention** to the alert channels' retention, as [slack-app/README.md](./slack-app/README.md#deploying-it) sets them up, so that no record outlives the alert it's about. A shorter setting forgets older records a thousand at a time, as alerts are sent.
    - At most 100,000 entries are kept, one for each post or comment an alert quotes; past that, the oldest are forgotten first. At about a kilobyte an alert, that keeps the store to about 100 MB, inside the 5 GB of Redis Devvit documents for an installation.
    - A deletion reads the alerts quoting the post or comment a hundred at a time, and queues their redactions in requests of at most a megabyte, so a busy thread's post, quoted by thousands of alerts, is redacted in full. Redactions wait 5,000 at most, as below.
    - Alerts **Test Slack Connection** or **Simulate Mod Action** send aren't remembered.

**Direct sends.** **Test Slack Connection** and **Simulate Mod Action** skip the queue, because a moderator is waiting for the answer. They retry after 1, 2 and 4 seconds before reporting failure. A simulated alert says it is one, in its text and footer, and its channel override can name only the Notification or Alert Channel: the bot token reaches every channel the Slack app is in. An alert the queue can't take, when Redis fails, goes straight to Slack too; it isn't remembered, so it keeps its quotes if its content is deleted later.

## Data stored

**Content and metadata.** The [Privacy Policy](./PRIVACY-POLICY.md#content-and-metadata) defines both, as Reddit's rules for apps use them. **Content** is what redditors write: titles and text of posts and comments. **Metadata** is the record of moderation: action types, IDs of posts, comments and actions, times, ban lengths, and usernames as the moderator who acted or the user acted on. Each key below holds one of them, or nothing about anyone. Only the queue holds content, for at most a day. No key holds a mod note or a Reddit user ID (`t2_…`).

**Redis.** All of this is per installation. Every key expires, or is cleared once it's used, apart from the Slack connection, kept until it's replaced or emptied.

| Key                                                                                                           | Kind                 | Holds                                                                                                                               | Kept for                                                                                         | Limit                   |
| ------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------- |
| `mod_actions:moderator_actions:{subreddit}:{account}`                                                         | metadata             | the account's recent action IDs, by time: a moderator's, or one of Reddit's accounts'                                               | 1 hour                                                                                           | 100 actions             |
| `mod_actions:discipline_events:{ban\|mute}:{subreddit}:{user}`                                                | metadata             | the user's bans or mutes and their lifting: time, moderator, details (the length); written only while alerts for the lifting are on | 90 days                                                                                          | 20 events               |
| `mod_actions:reported:{actionId}`                                                                             | metadata             | that an action was alerted                                                                                                          | 1 day                                                                                            | one per alert           |
| `post_deletion:alerted:{postId}`                                                                              | metadata             | that a deletion was alerted                                                                                                         | 1 day                                                                                            | one per alert           |
| `mod_actions:throttle:modqueue_{size\|spam\|edited\|unmoderated\|reported}`                                   | none                 | that an alert of that kind was sent                                                                                                 | 1 hour                                                                                           | 5 keys                  |
| `scheduler_failure_count`                                                                                     | none                 | the monitor's failures in a row                                                                                                     | 1 hour                                                                                           | 1 key                   |
| `slack_outbox_alerts`                                                                                         | content and metadata | queued messages for the alert channel, each with the IDs of the content it quotes and a version without it                          | 1 day                                                                                            | 500 messages            |
| `slack_outbox`                                                                                                | content and metadata | queued messages for the notification channel, the same way                                                                          | 1 day                                                                                            | 500 messages            |
| `mod_actions:burst:{subreddit}:{account}`                                                                     | metadata             | an open burst: when it opened, its latest removal, when its summary runs and last went, and its removals by type                    | 1 hour from its last write                                                                       | one per account         |
| `mod_actions:burst_closing:{subreddit}:{account}:{due}`                                                       | metadata             | a burst while its summary closes it                                                                                                 | deleted once read; 1 hour at most                                                                | one per burst           |
| `mod_actions:burst_run:{subreddit}:{account}:{due}`, `mod_actions:burst_rescue:{subreddit}:{account}:{since}` | none                 | that a summary's run started, or was scheduled again                                                                                | 1 hour                                                                                           | one per run             |
| `health:conditions`                                                                                           | none                 | the health conditions in force, each with when it started                                                                           | 7 days from when one was last met                                                                | 9 conditions            |
| `health:last`                                                                                                 | none                 | when each event (a trigger, an alert delivered or dropped, a monitor run) last happened                                             | 7 days from the last                                                                             | 8 events                |
| `health:count:{day}`                                                                                          | none                 | how many of each event a UTC day saw                                                                                                | 8 days                                                                                           | 8 counts a day          |
| `health:summary:{day}`                                                                                        | none                 | that the summary of a UTC day was sent                                                                                              | 2 days                                                                                           | 1 per day               |
| `stats:actions:{day}`, `stats:hours:{day}`, `stats:bans:{day}`                                                | metadata             | the day's actions by who took them and type, moderators' actions by hour, and bans                                                  | 15 days                                                                                          | 1 each a day            |
| `stats:active:{day}`                                                                                          | metadata             | hashes of the moderators who acted that day, each with when they last did                                                           | 15 days                                                                                          | 1 a day                 |
| `stats:threads:{day}`                                                                                         | metadata             | removals on each post, by ID                                                                                                        | 15 days                                                                                          | 10,000 posts a day      |
| `stats:counted:{actionId}`                                                                                    | metadata             | that an action was counted                                                                                                          | 1 day                                                                                            | one per action          |
| `stats:digest:{from}`                                                                                         | none                 | that a week's statistics were sent                                                                                                  | 8 days                                                                                           | 1 a week                |
| `stats:outcomes:{day}`                                                                                        | metadata             | the day's response times by range, how reported and filtered items ended, reversals, and modmail reply times by range               | 15 days                                                                                          | ~25 fields a day        |
| `stats:awaiting`                                                                                              | metadata             | the posts and comments waiting for a moderator: ID, since when, and whether reported or filtered                                    | a week, pruned weekly                                                                            | 10,000 items            |
| `stats:modmail_waiting`                                                                                       | metadata             | the conversations whose user awaits a reply: ID, and since when                                                                     | a week, pruned weekly                                                                            | 10,000 conversations    |
| `stats:removed:{day}`                                                                                         | metadata             | the posts and comments removed that day, with `reddit` or the remover's hash                                                        | 2 days                                                                                           | one per removal         |
| `security:last_action`                                                                                        | metadata             | when each moderator last acted, by lower-cased username                                                                             | 400 days from each moderator's last, at most a day late; forgotten when they leave the team      | one field per moderator |
| `security:last_action_pruned`                                                                                 | none                 | that moderators silent for 400 days were forgotten that day                                                                         | 1 day                                                                                            | one                     |
| `security:woke:{moderator}`                                                                                   | metadata             | that a moderator's waking was alerted                                                                                               | 1 day                                                                                            | one per moderator       |
| `security:automod_removals:{hour}`                                                                            | none                 | AutoModerator's removals by minute of the hour                                                                                      | 2 days                                                                                           | 60 fields               |
| `security:automod_edit`                                                                                       | metadata             | the last edit to AutoModerator's config: when, and by whom                                                                          | 1 day                                                                                            | 1 key                   |
| `security:misfire:{editAt}`                                                                                   | none                 | that a misfire after an edit was alerted                                                                                            | 1 day                                                                                            | one per edit            |
| `security:config_edit:{revisionId}`                                                                           | none                 | that an edit to AutoModerator's config was alerted                                                                                  | 1 day                                                                                            | one per revision        |
| `reports:urgent:{itemId}`, `reports:pileup:{itemId}`                                                          | metadata             | that an item's urgent report, or pile-up, was alerted                                                                               | 1 day                                                                                            | one per item            |
| `modmail:admin:{messageId}`                                                                                   | metadata             | that an admin's modmail message was alerted                                                                                         | 1 day                                                                                            | one per message         |
| `modmail:throttle:waiting`                                                                                    | none                 | that the waiting-modmail alert was sent                                                                                             | 6 hours                                                                                          | one                     |
| `approved_edits:approved:{itemId}`                                                                            | metadata             | the item's latest approval: the moderator's username, and when                                                                      | the configured days, at most 30                                                                  | one per item            |
| `approved_edits:alerted:{itemId}`                                                                             | metadata             | that an edit to the item was alerted                                                                                                | 1 day                                                                                            | one per item            |
| `health:notice:{condition}`                                                                                   | none                 | that moderators were sent a notice of the condition within the day                                                                  | 1 day                                                                                            | 1 per condition         |
| `health:noticed`                                                                                              | none                 | the conditions moderators were sent a notice of, so their end is sent                                                               | 7 days from the last                                                                             | 7 conditions            |
| `health:reminder:{condition}`                                                                                 | none                 | that a condition was logged within the day                                                                                          | 1 day                                                                                            | 1 per condition         |
| `slack_outbox_deleted`                                                                                        | metadata             | the IDs of posts and comments deleted on Reddit, by time                                                                            | 1 day and 1 second                                                                               | one per deletion        |
| `slack_outbox_sent_alert:{channel}:{ts}`                                                                      | metadata             | an alert in Slack that quotes a post or comment: its version without quotes                                                         | `slackRetentionDays` from when it was sent, at most 90 days                                      | one per entry's alert   |
| `slack_outbox_sent_by_content`                                                                                | metadata             | an entry (`{contentId} {channel} {ts}`) for each post and comment each remembered alert quotes, sorted by entry                     | each entry until the next alert after its alert expires; all `slackRetentionDays` after the last | 100,000 entries         |
| `slack_outbox_sent_by_time`                                                                                   | metadata             | the same entries, by when each alert was sent                                                                                       | as `slack_outbox_sent_by_content`                                                                | 100,000 entries         |
| `slack_outbox_sent:{contentId}`, `slack_outbox_sent`                                                          | metadata             | where alerts quoting a post or comment are in Slack, as an earlier version kept it; read and deleted on the content's deletion      | what was left expires within 90 days of the upgrade                                              | none added              |
| `slack_outbox_redactions`                                                                                     | metadata             | redactions waiting: where each alert is, and its version without quotes                                                             | 1 week                                                                                           | 5,000                   |
| `slack_outbox_lease`                                                                                          | none                 | which run is delivering                                                                                                             | 46.1 seconds                                                                                     | 1 key                   |
| `slack_outbox_last_sent`                                                                                      | none                 | when Slack was last sent a message                                                                                                  | 1 minute                                                                                         | 1 key                   |
| `slack_outbox_refusing`                                                                                       | none                 | the channel Slack last refused an alert to, so only an alert taken there ends the condition                                         | 1 day                                                                                            | one                     |
| `slack_connection`                                                                                            | secret               | the bot token of the moderators' Slack app, and the workspace's name                                                                | until Connect Slack replaces or empties it, or the app is uninstalled                            | one                     |
| `slack_outbox_drain_scheduled`, `slack_outbox_recovery_scheduled`                                             | none                 | that a follow-up or recovery run is scheduled                                                                                       | until it runs                                                                                    | 1 key each              |

**Settings** are stored by Devvit for each installation. The Slack app's bot token isn't one of them: **Connect Slack** keeps it in Redis (`slack_connection`), and no form shows it.

**Slack.** Alerts quote Reddit content: titles, and excerpts of up to 200 characters of removed posts and comments. Content deleted before an alert is sent leaves it; content deleted after, while the alert is within the channels' retention (`slackRetentionDays`, at most 90 days), is taken out of it in Slack, by an edit or, failing that, by deleting the alert. Alerts stay in Slack under your workspace's message retention.

**Logs.** Devvit keeps the app's logs for 7 days, up to 5,000 entries. They record errors and never quote Reddit content; the one line that names an account is the one reporting an account not on the mod list. The bot token travels only in a request header, so no line names it.

## Access control

Reddit shows the six menu actions only to moderators, but Devvit runs a menu action's handler for whoever invokes it. So each menu action, and each form it opens, checks that the user has moderator permissions in the subreddit. If they don't, or if Reddit can't say, the action is refused with `🔒 Only this subreddit's moderators can use this.`

## Troubleshooting

### Show Bot Status

Moderators can't read the app's logs, so this is where they see how it's doing. It shows a form of read-only lines:

| Line                  | Says                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App version           | The version installed.                                                                                                                                               |
| Current problems      | Each health condition in force (see [Reading the logs](#reading-the-logs)), with what the app saw and for how long, and what to do; or `None`.                       |
| Alerts waiting        | How many messages wait in the alert queue, delivered first, and how long the oldest has waited.                                                                      |
| Notifications waiting | How many messages wait in the notification queue, and how long the oldest has waited. Many here and none above means a backlog of routine alerts.                    |
| Last alert delivered  | When Slack last took an alert, or `None in the last week`.                                                                                                           |
| Slack app             | `Connected to <workspace>`, or what is missing: the connection (use **Connect Slack**) or the notification channel. Without both, no alerts are sent.                |
| Modqueue monitor      | `On, scheduled (cron …)`; `On, but not scheduled` (run **Setup Modqueue Monitoring**); `Off`, when all its thresholds and Modmail Waiting Alert are 0; or `Unknown`. |
| Last monitor run      | When the monitor last ran, and whether it succeeded.                                                                                                                 |
| Last events           | When the app last heard of a mod action, a deleted post and a deleted comment. Nothing for a week suggests Reddit isn't calling the app.                             |
| Today (UTC)           | Mod actions heard of, alerts delivered, dropped and redacted, and monitor runs and failures, since midnight UTC.                                                     |

A line reads `Unknown: Redis could not be read` when Redis fails; the rest still show.

### Test Slack Connection

| Result                                    | Meaning                                                                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `🧪 Test alert sent!`                     | Slack accepted the message, in the notification channel.                                                                      |
| `⚠️ Slack isn't connected.`               | Use **Connect Slack**: see [slack-app/README.md](./slack-app/README.md).                                                      |
| `⚠️ No Notification Channel is set.`      | Set it in the app's settings.                                                                                                 |
| `❌ Slack did not accept the test alert.` | Slack refused it or couldn't be reached. Check the channel, that the Slack app is in it, and the logs for Slack's error code. |

### Connect Slack

| Result                                  | Meaning                                                                                                    |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `✅ Connected to <workspace>.`          | Slack took the token and a message in each alert channel. Alerts are sent with it from now on.             |
| `❌ That isn't a bot token.`            | It doesn't start `xoxb-`. Copy the Bot User OAuth Token from the Slack app's **OAuth & Permissions** page. |
| `❌ Slack didn't take that token (…)`   | Slack's error code says why: `invalid_auth` for a token it doesn't know, `token_revoked` for one revoked.  |
| `❌ Slack didn't post to <channel> (…)` | Usually `not_in_channel`: add the Slack app to the channel, then connect again. Nothing was kept.          |
| `⚠️ Set the Notification Channel …`     | Set it in the app's settings first, as connecting posts to it.                                             |
| `Slack is disconnected: …`              | The token was left empty. No alerts are sent until Slack is connected again.                               |

### Common problems

- **No alerts at all.**
    - Run **Test Slack Connection**.
    - Check the action types are enabled and the moderator isn't excluded.
    - Check AutoModerator alerts are on, if the actions are AutoModerator's.
- **Alerts in the wrong channel.** Without an alert channel, security, modqueue and deleted-post alerts go to the notification channel.
- **Slack is refusing alerts.** Show Bot Status gives Slack's error code. `not_in_channel`: add the Slack app to the channel. `channel_not_found`: check the channel ID, and that the Slack app is in a private channel. `is_archived`: the channel was archived. `invalid_auth`, `token_revoked` or `account_inactive`: the token needs replacing, as [slack-app/README.md](./slack-app/README.md#replacing-a-token-that-leaked) says.
- **Alerts arriving slowly during busy periods.** That's the 1.1-second pacing at work: 60 alerts take about a minute to deliver. Alerts for the alert channel go first, and **Show Bot Status** shows each queue.
- **A moderator's removals stopped alerting.** They removed five or more in a minute, so the rest are in a burst. A summary follows a minute after their last removal, and every five minutes while they go on.
- **A burst's summary that never came.** Its job was lost, and no later removal was there to schedule it again. The burst record expires an hour after its last write, and the next burst starts afresh.
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

Each line starts with its area in brackets: `[health]`, `[setup]`, `[modaction]`, `[postdeletion]`, `[deletions]`, `[modqueue]`, `[outbox]`, `[slack]`, `[settings]`, `[menu]`, `[security]`, `[statistics]`, `[reports]`, `[modmail]` or `[approvededits]`. Lines never quote Reddit content, and never name the bot token.

**Health conditions.** A problem that lasts is a condition. It is logged once when it starts, once a day while it lasts (`Since <time>: …`), and once, at INFO, when it ends. This keeps it from filling the 5,000 entries.

| Condition                                        | Level | Starts when                                                                                                                                            | Ends when                                      | Modmail            |
| ------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- | ------------------ |
| Slack isn't connected                            | WARN  | a mod action finds no connection                                                                                                                       | a mod action finds one                         |
| No Slack channel is set                          | WARN  | a mod action finds no notification channel                                                                                                             | a mod action finds one                         | never              |
| Slack is refusing alerts                         | ERROR | Slack refuses an alert with an error code, and it is dropped                                                                                           | Slack takes an alert to the channel it refused | at once            |
| Slack is not taking alerts                       | WARN  | a run leaves an alert queued after Slack failed or timed out                                                                                           | Slack takes an alert                           | after half an hour |
| The alert queue is full                          | ERROR | a new alert pushes the oldest of 500 out                                                                                                               | a run empties the queue                        | at once            |
| Alerts are dropped after waiting a day           | ERROR | a run drops an alert queued over a day ago                                                                                                             | a run empties the queue                        | at once            |
| Deleted content is not being taken out of alerts | ERROR | Slack refuses a redaction, or one is dropped unmade (unreadable, a week old, more than 5,000 waiting, or Redis could not remember where an alert went) | a redaction is made                            | never              |
| The modqueue monitor is failing                  | ERROR | a monitor run fails                                                                                                                                    | a monitor run succeeds                         | after half an hour |
| Modmail cannot be read                           | ERROR | reading modmail fails, for an admin's message or the waiting check                                                                                     | a modmail read succeeds                        | after half an hour |

**Modmail notices.** Slack may be the very thing that is broken, so a condition moderators must act on also goes to the subreddit's modmail, as a notification from the app's account (in modmail's Notifications). The Modmail column says when. A notice gives the problem, what the app saw, what to do and when it started. Each condition is sent at most once a day, so a problem that comes and goes doesn't flood modmail, and again each day it lasts. Its end is sent too, when its start was. A notice modmail can't take (for example if the app's account is banned) is logged as `[health] Could not send moderators a modmail notice:`, and tried again with the condition's next report.

Lines that need attention besides those:

| Line                                                        | Meaning                                                                                                                         |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `[deletions] Could not take a deleted post or comment …`    | Redis failed as content was deleted. Alerts already queued may be sent quoting it.                                              |
| `[settings] Could not read the settings, so no alerts …`    | The settings couldn't be read, and none had been before in this app process: nothing is sent.                                   |
| `[setup] Could not set up the modqueue monitor …`           | Scheduling failed. Use **Setup Modqueue Monitoring** to try again.                                                              |
| `[postdeletion] Could not check a deleted post:`            | Reddit couldn't return the post's score, so no deleted-post alert was considered.                                               |
| `[outbox] Could not deliver the queued alerts …`            | Redis failed during a run; the alerts wait for the next one.                                                                    |
| `[modaction] An account not on the mod list took an action` | Sent as a security alert.                                                                                                       |
| `[security] Could not read AutoModerator's config …`        | Reddit couldn't return the config page's revisions; the wiki edit was not checked.                                              |
| `[security] Could not watch a mod action:`                  | Redis failed during the security watch; the alert for the action itself was not affected.                                       |
| `[approvededits] Could not remember an approval …`          | Redis failed as a moderator approved something; an edit after that approval won't be alerted.                                   |
| `[approvededits] Could not check an edit …`                 | Redis failed reading an approval; the edit was not alerted.                                                                     |
| `[statistics] Could not count a mod action:`                | Redis failed while counting an action; the team's statistics miss it.                                                           |
| `[statistics] Could not note an item waiting …`             | Redis failed on a report or AutoModerator filter; the item's response time isn't counted.                                       |
| `[statistics] Could not count a modmail message:`           | Redis failed on a modmail message; its reply time may be missed.                                                                |
| `[statistics] Could not forget what waited over a week:`    | Redis failed during the weekly job; the next run tries again.                                                                   |
| `[modaction] Could not read the user's mod notes …`         | Reddit couldn't return the banned user's mod notes, or gave no name for the subreddit. The ban was alerted without its history. |
| `[health] Could not record a condition:`                    | Redis failed while noting a problem; the work went on, and the problem may be logged again.                                     |

**Completion lines.** Each trigger, scheduler job, menu item and form runs as an invocation (`src/invocations.ts`). Its Devvit APIs and Slack calls are counted and timed, and it ends with one line of JSON, `[invocation] {…}`:

| Field                                               | Holds                                                                                                                                                                                |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`                                                | a correlation id, eight letters and digits                                                                                                                                           |
| `handler`                                           | the trigger's event type (`ModAction`), the job's name (`slackOutbox`), `menu:<label>` or `form:<label>`                                                                             |
| `subreddit`, `target`                               | the installation's subreddit ID, and the post, comment or modmail conversation the event is about                                                                                    |
| `outcome`, `ms`                                     | `ok`, or `failed` when the handler rejected; and how long it took                                                                                                                    |
| `redis`, `reddit`, `settings`, `scheduler`, `slack` | each dependency's calls and their time, `{"n": …, "ms": …}`. A Reddit listing's pages count as the call that made it                                                                 |
| `failedCalls`, `alerts`                             | dependency calls that rejected, whether handled or not; alerts handed to the outbox                                                                                                  |
| `slowest`, `lastCall`                               | the slowest single call and its time; the last call made                                                                                                                             |
| `error`, `message`                                  | for a failed invocation: `code` (`redis-failed`, `reddit-failed`, `slack-failed`, … or `internal`), `class`, and `stage`, the call that failed; and the error's first 100 characters |
| `eventBytes`, `heldBack`                            | the event's size as JSON; how many lines like it were held back since the last                                                                                                       |

It holds ids, counts and times: never content, a username or the token. It's logged:

- **For every invocation**, at INFO, while **Debug Logging** is on for the subreddit. An invocation that reads no settings (a comment deletion, an AutoModerator hold) follows the setting as the installation last read it.
- **Otherwise only for one that failed** (ERROR) or took 20 seconds or more (WARN), at most once a minute for each handler, counting those held back. An outage that fails every event logs a line a minute, not one an event.

**During an incident**, ask a moderator to turn on Debug Logging, read the lines with `npx devvit logs <your-subreddit> --since 1h --json`, and have it turned off afterwards: at 30 events a minute, Devvit's 5,000 entries last under three hours.

**Health signals.** What to check after a deploy and during an incident. "Normal" is a busy subreddit (30 events a minute) on the load harness (`npm run load`, [docs/reviews/2026-11-06-observability-load-pass.md](./docs/reviews/2026-11-06-observability-load-pass.md)). Lines marked _debug_ need Debug Logging on.

| Signal                            | Where                                                                                                  | Normal                                                                                                                  | A problem                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Events arriving, by handler       | _debug_ lines by `handler`; **Show Bot Status**, "Last events"                                         | about 30 a minute: comment edits and deletions most, then mod actions                                                   | none for an hour on an active subreddit: Reddit isn't calling the app                                                                         |
| **The app silently not alerting** | **Show Bot Status**: "Last events" against "Last alert delivered"; _debug_ `ModAction` lines' `alerts` | alerts follow enabled mod actions within seconds                                                                        | mod actions arriving for an hour, none alerted, and no condition in force: check the enabled actions, the excluded moderators and the channel |
| Failed invocations                | ERROR `[invocation]` lines, always logged                                                              | none                                                                                                                    | any; one with `heldBack` means a failure on every event: its `error.code` names the dependency                                                |
| Duration, p50 and p95 by handler  | _debug_ `ms`                                                                                           | most handlers p95 under 20 ms; an alerting mod action about 1.1 s, Slack's pace                                         | WARN `[invocation]` lines, logged at 20 s or more: near Devvit's execution limit                                                              |
| Redis calls an invocation         | _debug_ `redis.n`                                                                                      | edit 1, AutoModerator hold 3, report 4 to 31, deletion 10 to 18, mod action 20 to 83                                    | above the budgets in [dependencyBudgets.test.ts](./tests/integration/dependencyBudgets.test.ts): a regression                                 |
| Settings calls an invocation      | _debug_ `settings.n`                                                                                   | 1, or 0                                                                                                                 | more than 1: a regression (each fetches every setting)                                                                                        |
| Reddit calls a minute             | _debug_ `reddit.n`                                                                                     | about 2                                                                                                                 | tens: an unknown account refetching the mod list on each action, or the monitor's listings grown large                                        |
| Slack calls a minute              | _debug_ `slack.n`                                                                                      | about 7                                                                                                                 | none while messages are queued (**Show Bot Status**, "Alerts waiting" and "Notifications waiting"): Slack isn't taking them                   |
| Scheduler runs                    | _debug_ `modqueueMonitor`, `slackOutbox`, `removalBurst` lines                                         | the monitor every 15 minutes, under a second; the outbox after alerts; a burst's job about once a minute while it lasts | the monitor missing, or a "monitor is failing" condition                                                                                      |
| Redis transactions                | _debug_ `redis.n`, which counts `redis.tx.*`                                                           | one for each removal held in a burst: nine calls (WATCH, MULTI, six commands, EXEC)                                     | a held removal's `ModAction` line well above its budget of 39 Redis calls                                                                     |

## Known limitations

- **Deleted content is taken out of alerts within the channels' retention.** Devvit's rules ask apps to delete content of deleted posts and comments from external services. The app does, in alerts not yet sent and in alerts Slack has held for up to `slackRetentionDays` days, at most 90 (or, with heavy traffic, until 50,000 newer posts and comments have been quoted). An alert older than that keeps its quotes, unless the channel's retention has removed it, as it does when the setting matches.
- **Modmail waits are counted from the user's last message.** Reddit gives the time a user last wrote in a conversation, not when their unanswered messages began, so a user who writes again appears to have waited less. Each folder is read up to 100 conversations, the most Reddit lists at once; beyond that the alert says "at least".
- **Response times start at what the app saw.** Items reported or filtered before the app was installed, or while it was not running, aren't timed; neither are items waiting over a week. The modmail reply time runs from a user's first message since a moderator last replied.
- **Deleted accounts.** Reddit doesn't tell apps when an account is deleted, so usernames stay in alerts in Slack until the channels' message retention removes them, and in the ban and mute history until it expires. On a paid Slack plan, set the alert channels to delete messages after 30 days, as Reddit recommends for data about redditors. The free plan can only set the whole workspace to delete messages after 90 days, or keep them for a year. [slack-app/README.md](./slack-app/README.md#deploying-it) has the steps.
- **Ban and mute history is kept for 90 days**, longer than the 30 days Reddit recommends for data about redditors, so that unbans after longer bans keep their context. It is moderation metadata only (who, on whom, when, how long), and it is kept only while unban or unmute alerts are on. Turning those on later finds no ban or mute taken while they were off.
- **The monitor reads each listing in full.** Reddit's listings end at around a thousand items, so a run makes at most a few dozen requests.
- **Handler time limits.** Devvit doesn't document a time limit for Blocks handlers. The outbox keeps each run to about 10 seconds plus one request, and recovers a run that's cut off.
- **Blocks is deprecated.** Devvit 0.15 still supports the Blocks API the app is built on, but marks it deprecated. A later move to Devvit Web is expected.
