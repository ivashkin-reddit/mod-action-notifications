# Mod Action Notifications

Your subreddit's moderation activity, in your team's Slack.

Mod Action Notifications is a moderation tool for subreddit moderation teams that coordinate in Slack. It posts the moderator actions you choose to a Slack channel as they happen. It warns you about anything that needs a second look: an action by an account that isn't on your mod list, a moderator acting unusually fast, a modqueue that's backing up, or a popular post deleted by its author. Your team can keep up with the subreddit without refreshing the mod log.

It runs entirely on Reddit's Developer Platform (Devvit). It has no servers of its own, and the only service it sends anything to is your Slack workspace.

**Developer:** u/ivashkin · **License:** MIT · **Platform:** Reddit Devvit 0.15

## What it does

**Mod action alerts.** Choose which moderator actions to hear about: removals, spam, approvals, bans, mutes, locks, flair edits, moderator changes and more. Each alert shows the action, the moderator, the user, a link to the content and a short quote of it, and when it happened.

**Security alerts.** Changes to your mod team (moderators added, removed or invited, and changes to their permissions) and to the Devvit apps installed in your subreddit always come as security alerts, to a separate channel if you like. So do an edit to AutoModerator's config (who made it, why, and how many lines changed, never the config itself), AutoModerator removing far more than usual in the hour after one, and a moderator acting for the first time in 90 days, as a compromised account might. So does an action by an account that isn't on your mod list. Actions by Reddit's own accounts (u/reddit for Crowd Control and Reddit's filters, and Anti-Evil Operations for admin removals) are labelled as Reddit actions, not as security alerts.

**Ban and mute context.** A ban alert shows how long the ban lasts, read from the mod log, and counts what Reddit's mod notes record about the user in the 30 days before (removals, spam removals, bans, mutes and notes), without their text. When a user is unbanned or unmuted, the alert names the ban or mute being lifted: who issued it, when, and for how long. The app keeps that as metadata, never the mod note, for 90 days, and only while unban or unmute alerts are on.

**Urgent reports.** Name the report reasons that can't wait, such as personal information or threatening violence, and a report with one of them alerts you at once, naming the reason as you wrote it, never the reporter's words. You can also be alerted when a post or comment piles up reports.

**Modmail from Reddit's admins.** When a Reddit admin writes to your subreddit's modmail, the app alerts you at once, with the conversation's subject and a link to it. Turn on Modmail Waiting Alert to hear when users have waited too long for a reply, with ban appeals counted apart, at most every six hours.

**Edits after approval.** When someone edits a post or comment a moderator approved in the last 7 days, a common way to slip rule-breaking content past review, the app tells you who edited it, who approved it and how long before, with a link. It never shows either version of the text.

**Activity spikes.** When one moderator takes five or more actions within a minute, the alert says so.

**Modqueue monitoring.** Every 15 minutes the app checks your queues. It alerts your team when the modqueue grows past a size you set, when content has waited too long without a moderator reviewing it, and when reported content has gone unhandled for too long. Each kind of alert is sent at most once an hour. It can also watch Reddit's spam queue and edited queue.

**Deleted high-score posts.** When a user deletes their own post after it scored highly, a common way to hide content from moderators, the app tells you its score and links to it. The alert leaves out the post's title and author, as Reddit asks apps to delete a deleted post's content.

**Daily summary.** Turn on the Daily Summary setting for a morning post of the day before's numbers, and any problems.

**Team statistics.** **Show Team Stats** shows your team's moderation over the last 7 days: how many actions, and who took them (moderators, AutoModerator, Reddit), the most common, the hours no moderator acted, bans and their lengths, how many moderators acted, and the most-moderated threads. Turn on Weekly Statistics for the same each Monday in Slack. The figures are for the team as a whole: none is any one moderator's.

**Problems in modmail.** If alerts stop reaching Slack (a revoked token, a channel the Slack app was removed from, a Slack outage of half an hour or more) or the modqueue monitor keeps failing, or the app can't read modmail, the app tells you in your subreddit's modmail, at most once a day, and again when it's fixed. **Show Bot Status** shows how it's doing at any time.

**Built for busy days.** Slack accepts about one message a second to a channel. During a burst of activity, alerts wait in a queue and are delivered in order at that pace, so none are lost.

## Getting started

You'll need moderator permissions on the subreddit and a Slack workspace where you can add an app.

1. **Install the app** on your subreddit. This is a private moderation app, uploaded from this repository with the Devvit command-line tool. The [Operators Guide](./OPERATORS-GUIDE.md#deploying) walks through it.
2. **Set up the Slack app.** Alerts are posted by a Slack app in your workspace, made from the template in [slack-app/](./slack-app/README.md), which says how. Whoever deploys the app gives it the Slack app's token; moderators never see it. Add the Slack app to the channels alerts should go to.
3. **Open the app's settings** for your subreddit and enter the channel's ID as the Notification Channel. Choose the mod actions you want alerts for; the defaults cover removals, spam and bans.
4. **Send a test.** From the subreddit's mod tools menu, choose **Test Slack Connection**. A test message should arrive in Slack within seconds.
5. **Turn on modqueue monitoring.** Set the thresholds you want, then choose **Setup Modqueue Monitoring**. Run it again whenever you turn monitoring on or off.

## Settings

| Setting                               | What it does                                                                                                                                                                                                                   | Default                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| Enabled Mod Actions                   | Which moderator actions send an alert.                                                                                                                                                                                         | removals, spam, bans and unbans |
| Excluded Moderators                   | Moderators whose actions never send an alert, separated by commas (useful for bots).                                                                                                                                           | none                            |
| Flag Unknown Moderators               | Send actions by accounts not on the mod list as security alerts.                                                                                                                                                               | on                              |
| Security Alerts                       | Always send changes to the mod team and to its Devvit apps as security alerts, whatever Enabled Mod Actions and Excluded Moderators say.                                                                                       | on                              |
| Dormant Moderator Alert (Days)        | A moderator's first action after at least this many days sends a security alert. 0 turns it off.                                                                                                                               | 90                              |
| Include Mod Note                      | Show moderator notes in alerts. Reddit includes notes for bans only.                                                                                                                                                           | on                              |
| Ban Alert History (Days)              | How many days of the user's mod notes a ban alert counts; 0 leaves the history out.                                                                                                                                            | 30                              |
| Notification Channel                  | The Slack channel for alerts and the daily summary: its channel ID, or a public channel's name. The Slack app must be in it. Alerts aren't sent until it's set.                                                                | none                            |
| Alert Channel                         | Slack channel for security, modqueue and deleted-post alerts.                                                                                                                                                                  | the notification channel        |
| Slack Message Retention (Days)        | How many days your alert channels keep messages in Slack, from 1 to 90. For that long the app remembers where each alert quoting a post or comment is, to take the content out if it's deleted. Set it to match your channels. | 90                              |
| Modqueue Size Alert Threshold         | Alert when the modqueue holds at least this many items.                                                                                                                                                                        | 50                              |
| Unmoderated Content Age Alert (Hours) | Alert when content has waited this long without a moderator reviewing it.                                                                                                                                                      | 24                              |
| Old Reported Content Alert (Hours)    | Alert when reported content is this old and still waiting.                                                                                                                                                                     | 24                              |
| Spam Queue Size Alert Threshold       | Alert when the spam queue holds at least this many items.                                                                                                                                                                      | 0 (off)                         |
| Edited Queue Size Alert Threshold     | Alert when the edited queue, of recently edited posts and comments, holds at least this many items.                                                                                                                            | 0 (off)                         |
| Modmail Waiting Alert (Hours)         | Alert, at most every six hours, when a user has waited this many hours for a reply in modmail. Ban appeals are counted apart.                                                                                                  | 0 (off)                         |
| Urgent Report Reasons                 | Report reasons that alert you at once, separated by commas, e.g. personal information, threatening violence.                                                                                                                   | none                            |
| Report Pile-Up Alert Threshold        | Alert once when a post or comment reaches this many reports.                                                                                                                                                                   | 0 (off)                         |
| Admin Modmail Alerts                  | Alert at once when a Reddit admin writes to your subreddit's modmail.                                                                                                                                                          | on                              |
| Edits After Approval Alert (Days)     | Alert when an author edits a post or comment a moderator approved within this many days, from 0 to 30.                                                                                                                         | 7                               |
| Enable AutoModerator Slack Alerts     | Also send alerts for AutoModerator's actions.                                                                                                                                                                                  | off                             |
| Post Deletion Alert Threshold         | Alert when a user deletes their own post with at least this score.                                                                                                                                                             | 100                             |
| Daily Summary                         | Each morning at 08:00 UTC, post a summary of the day before to the notification channel: mod actions, alerts, monitor runs and any problems. If it stops arriving, the app has stopped working.                                | off                             |
| Weekly Statistics                     | Each Monday at 08:00 UTC, post the team's statistics for the week before to the notification channel. No figure names a moderator.                                                                                             | off                             |

Setting a threshold to 0 turns that alert off.

## Menu actions

These appear in the subreddit's mod tools menu, and only moderators of the subreddit can use them.

| Action                    | What it does                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Slack Connection     | Sends a test message and tells you whether Slack accepted it.                                                                                         |
| Show Bot Status           | Shows how the app is doing: any problems, alerts waiting for Slack, when it last delivered an alert and ran the modqueue monitor, and today's counts. |
| Show Team Stats           | Shows the team's moderation over the last 7 days, as a whole, and today's actions.                                                                    |
| Simulate Mod Action       | Sends a sample alert so you can see how alerts look, without touching any real data.                                                                  |
| Setup Modqueue Monitoring | Schedules or cancels the modqueue monitor to match your settings.                                                                                     |

## Your data

The app tells apart two kinds of data, as Reddit's rules for apps do:

- **Content** is what redditors write: the titles and text of posts and comments. Alerts quote a little of it, and the app takes it out of them when it's deleted on Reddit.
- **Metadata** is the record of moderation: which action, by which moderator, on which user, post or comment, when, and for how long. It's what your mod log already shows you, and it includes the IDs and times Reddit's rules let apps keep.

The app reads only what it needs to write an alert. Apart from alerts waiting to be sent, it keeps metadata only, and never mod notes or Reddit user IDs:

- **Ban and mute history** (metadata), to explain unbans: who banned or muted whom, when, and for how long. Kept for 90 days, and only while unban alerts (for bans) or unmute alerts (for mutes) are on.
- **Queued alerts** (content and metadata), for up to a day.
- **IDs of deleted posts and comments** (metadata), so alerts still waiting to be sent leave their text out: a day.
- **Where each alert quoting a post or comment went in Slack** (metadata), with the alert as it would read without the quote, so the quote can be taken out if the content is deleted: as long as your channels keep messages, set in **Slack Message Retention**, at most 90 days.
- **When each moderator last acted** (metadata), to spot a moderator acting after a long silence: 400 days, and forgotten when they leave the team.
- **Team statistics** (metadata): counts of the team's actions by day, kind and hour, bans by length, removals per thread, and how many moderators acted, by a short hash of each name rather than the name: 15 days.
- **Approvals** (metadata), to spot an edit after one: which moderator approved which post or comment, and when. Kept for as many days as **Edits After Approval Alert** says, 7 by default and at most 30.
- **Short-lived records** that pace alerts, prevent duplicates and note problems the app is having: a minute to a week.

Everything it keeps expires on its own. The only service it sends anything to is your Slack workspace.

Alerts quote Reddit content, such as titles and short excerpts of removed posts and comments. If a post or comment is deleted on Reddit before its alert reaches Slack, the alert goes without the quote and the title, with a link that still opens the content. If the content is deleted after its alert reached Slack, while your channels still keep the alert, the app edits the alert in Slack to the same version; where your workspace doesn't allow edits that late, it deletes the alert instead. Alerts stay in Slack under your workspace's message retention. Reddit doesn't tell apps when an account is deleted, so retention is also what takes a deleted account's username out of alerts. On a paid Slack plan, set the alert channels to delete messages after 30 days, as Reddit recommends, and keep them no longer than the 90 days the app can still edit them. Then set **Slack Message Retention** to the same number of days, so the app forgets where its alerts are when Slack deletes them. [slack-app/README.md](./slack-app/README.md#deploying-it) shows how, and what the free plan allows.

The [Privacy Policy](./PRIVACY-POLICY.md) and [Terms & Conditions](./TERMS-AND-CONDITIONS.md) have the details.

## Fetch Domains

The following domain is requested for this app:

- `slack.com`: Slack's Web API. The app posts moderation alerts with `chat.postMessage`, as the subreddit's own Slack app, to the channels its moderators choose in its settings. The app fetches no other domain.

## Documentation

- **[Operators Guide](./OPERATORS-GUIDE.md):** how the app works, deploying and upgrading it, the data it stores, and troubleshooting.
- **[Privacy Policy](./PRIVACY-POLICY.md)** and **[Terms & Conditions](./TERMS-AND-CONDITIONS.md)**.
- **[AGENTS.md](./AGENTS.md):** architecture and conventions for contributors.

## Support

Report problems on [GitHub Issues](https://github.com/ivashkin-reddit/mod-action-notifications/issues), or contact u/ivashkin on Reddit. If alerts stop arriving, start with **Test Slack Connection** and **Show Bot Status**. The [Operators Guide](./OPERATORS-GUIDE.md#troubleshooting) covers what they tell you.

## Contributing

Contributions are welcome. Fork the repository, make your change on a branch, and make sure the checks in [`.github/workflows/test.yml`](.github/workflows/test.yml) pass locally before opening a pull request. [AGENTS.md](./AGENTS.md) explains the architecture and conventions.

## License

MIT. The project is open source, free to adapt and redistribute under the MIT License.
