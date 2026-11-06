# Privacy Policy

**App:** Mod Action Notifications (Devvit app `ukpolitics-man`)  
**Developer:** u/ivashkin  
**Effective:** 6 November 2026

## In short

This app is a moderation tool. A subreddit's moderators install it so that their mod team sees moderation activity in their own Slack workspace. It reads moderation activity in that subreddit, sends alerts about it to the moderators' Slack, and keeps a few records, most of them for a day or less. It runs entirely on Reddit's Developer Platform, and sends nothing anywhere except that Slack workspace and the subreddit's own modmail. It sells nothing, shows no ads, and builds no profiles of anyone.

## Whom this policy is about

- **The subreddit's moderators**, who install the app, configure it and read its alerts. Their usernames appear in alerts about the actions they take.
- **Redditors whose posts, comments or accounts a moderator acts on**, and redditors who delete a post that scored highly. They never use the app and cannot see it, but their usernames and content pass through it.

The developer, u/ivashkin, is responsible for the app and for this policy. The subreddit's moderators are responsible for their Slack workspace, and for what they do with the alerts in it.

## Content and metadata

This policy sorts what the app handles into two kinds, as Reddit's rules for Developer Platform apps do.

- **Content** is what redditors write: the titles and text of posts and comments. Alerts quote a little of it, so that moderators can see what was acted on. Reddit's rules require apps to delete content once it is deleted on Reddit, and the app does (see [Deletions](#deletions)). It keeps content only in alerts waiting to be sent, for at most a day.
- **Metadata** is the record of moderation around that content: which action was taken, by which moderator, on which user, post or comment, when, and for how long. These are the fields the subreddit's mod log shows its moderators. Metadata includes the IDs of posts, comments and mod actions, and the times things happened, which Reddit's rules let apps keep as "metadata required for contextualizing related content (for example, post or comment ID, createdAt, etc.)". A redditor appears in metadata by username, as the moderator who acted or the user acted on.

Two other things stay out of the app's records. A **mod note**, the text a moderator writes about an action, appears only in alerts, and only when the Include Mod Note setting is on. Reddit **user IDs** (`t2_…`) are never stored.

## Where it runs

- **Reddit's Developer Platform (Devvit).** The app's code runs on Reddit's servers. Its records are kept in Devvit's storage for the subreddit's installation, which no other installation can read, and Devvit stores its settings. The developer runs no servers or databases of their own.
- **The moderators' Slack workspace.** The developer creates a Slack app in it, from the template in the app's repository, and gives the app the Slack app's token. The app posts alerts through Slack's Web API to the channels the moderators choose, and sends nothing anywhere else outside Reddit.
- **The subreddit's modmail.** Notices about problems with the app itself go there.

## What it reads from Reddit, and why

| Feature                    | What it reads                                                                                                                                                                                                    | Why                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Mod action alerts          | Each mod action in the subreddit: its type and time, the moderator, the user acted on, and the post or comment (title, link, and up to 200 characters of its text). For a ban, its length, details and mod note. | To tell the mod team about the action.                   |
| Ban lengths                | The subreddit's 10 most recent bans in the mod log, when a ban doesn't say how long it lasts.                                                                                                                    | To show how long the ban lasts.                          |
| Ban history                | When a ban is alerted: the banned user's entries in the subreddit's mod notes from the days before it (30 by default), their kinds and dates, not their text.                                                    | To show the ban in context.                              |
| AutoModerator config edits | When a moderator edits the subreddit's wiki: the latest two revisions of AutoModerator's config, who made them and why, and their text, to count lines changed. The text is never sent or kept.                  | To alert the mod team to changes to AutoModerator.       |
| Unknown moderators         | The subreddit's mod list, at most once every five minutes.                                                                                                                                                       | To flag an action by an account that isn't a moderator.  |
| Deleted posts              | A post deleted by its own author: its score, Reddit's deletion reason, and a link without its title.                                                                                                             | To flag a popular post deleted by its author.            |
| Deleted posts and comments | The ID of each post or comment deleted in the subreddit.                                                                                                                                                         | To take deleted content out of alerts not yet sent.      |
| Modqueue monitor           | The modqueue, unmoderated and reports listings: how many items wait, for how long, and links to the oldest.                                                                                                      | To warn the mod team when content waits too long.        |
| Menu actions               | The permissions of the person who opens one.                                                                                                                                                                     | To refuse anyone who isn't a moderator of the subreddit. |

It reads nothing else: no modmail, private messages or chats, no user profiles or post histories, and nothing from other subreddits.

## What it sends, and to whom

### The moderators' Slack workspace

Alerts can contain:

- usernames: of the moderator who acted, and of the user acted on;
- post titles, links, and up to 200 characters of a removed post's or comment's text;
- for a ban or mute, its length and details, and the mod note if the Include Mod Note setting is on; for a ban, how many removals, spam removals, bans, mutes and notes the user's mod notes record in the days before it; for an unban or unmute, who issued the ban or mute it lifts, when, and its length;
- for modqueue alerts, counts, and links to the oldest items waiting;
- a deleted post's score.

The daily summary, which is off unless the moderators turn it on, holds only counts.

Alerts travel over HTTPS. Text from Reddit is escaped, so it cannot notify a whole Slack channel.

Once an alert reaches Slack, it is kept under the workspace's message retention settings and Slack's privacy policy, and the moderators control it. If a post or comment an alert quotes is deleted on Reddit while the alert is still within the channels' retention, as the moderators set it in the app's **Slack Message Retention** setting (at most 90 days), the app takes the content out of the alert in Slack (see [Deletions](#deletions)). Otherwise the app does not change or delete an alert once it is in Slack, and the moderators can delete it there.

### The subreddit's modmail

When alerts cannot reach Slack, or the modqueue monitor keeps failing, the app sends the subreddit's modmail a notice from the app's account: what is wrong, what the app saw, and what to do. Notices contain no Reddit content or user data. Each problem is sent at most once a day, and once more when it ends.

### Nobody else

The app sends nothing to any other service. It does not sell, license or share data, show advertising, use analytics, train AI models, or profile or track redditors.

## What it keeps, and for how long

Everything the app keeps expires by itself. Apart from alerts waiting to be sent, it keeps metadata only (see [Content and metadata](#content-and-metadata)).

| What                                                                 | Kind                 | What it holds                                                                                                                                                                                                                   | Kept for                                                                                         |
| -------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Ban and mute history                                                 | Metadata             | For each ban, mute, unban and unmute: the usernames of the user and the moderator, when it happened, and the ban's length. The latest 20 per user. Kept only while unban alerts (for bans) or unmute alerts (for mutes) are on. | Until 90 days after the user's most recent ban or mute                                           |
| Alerts waiting for Slack                                             | Content and metadata | What each alert will say                                                                                                                                                                                                        | Until delivered, at most a day                                                                   |
| Moderator activity                                                   | Metadata             | Each moderator's username, with the IDs of their recent actions                                                                                                                                                                 | 1 hour                                                                                           |
| Alerts already sent                                                  | Metadata             | The IDs of the mod actions and posts alerted                                                                                                                                                                                    | 1 day                                                                                            |
| Posts and comments deleted on Reddit                                 | Metadata             | Their IDs                                                                                                                                                                                                                       | 1 day                                                                                            |
| Where alerts that quote a post or comment are in Slack               | Metadata             | The post's or comment's ID, where each alert is, and the alert without its quote: which action, by whom, on whom, when                                                                                                          | As many days as the alert channels keep messages, set in **Slack Message Retention**: at most 90 |
| Edits waiting to take deleted content out of alerts                  | Metadata             | Where each alert is, and the alert without its quote                                                                                                                                                                            | Until made, at most a week                                                                       |
| When each moderator last acted                                       | Metadata             | Each moderator's username, lower-cased, and the time of their latest action                                                                                                                                                     | 400 days from their latest action; removed when they leave the team                              |
| The last edit to AutoModerator's config                              | Metadata             | When it was made, and the moderator's username                                                                                                                                                                                  | 1 day                                                                                            |
| Team statistics                                                      | Metadata             | Counts of the team's actions by day, kind and hour; bans by length; removals per post, by ID; and how many moderators acted, as a short hash of each name. No figure is any one moderator's.                                    | 15 days                                                                                          |
| The app's own workings: alert pacing, its problems, counts and times | Neither              | Nothing about any redditor                                                                                                                                                                                                      | Up to 8 days                                                                                     |
| Settings: channels, alert choices, excluded moderators               | Configuration        | Usernames of excluded moderators                                                                                                                                                                                                | Until changed, or the app is uninstalled                                                         |
| The app's logs, kept by Reddit                                       | Metadata             | The username of an account not on the mod list, when one takes an action. No lines quote posts or comments.                                                                                                                     | 7 days, up to 5,000 lines                                                                        |

The ban and mute history is moderation metadata: who banned or muted whom, when, and for how long, the same fields the subreddit's mod log shows its moderators. It holds no mod note, no user ID and nothing a redditor wrote. It is kept for 90 days, longer than the 30 days Reddit recommends for data about redditors, so that an unban months after a long ban still says which ban it lifts. Only unban and unmute alerts read it, so the app keeps it only while those alerts are on: with unban alerts off it records no bans, and with unmute alerts off no mutes. Records an earlier version made can also hold the ban's mod note; nothing reads it, and it expires with them, within 90 days.

Uninstalling the app removes its records and settings. Alerts already in Slack and notices already in modmail stay.

## Who can see what

- **The subreddit's moderators** can see the app's settings, its modmail notices, and **Show Bot Status**, which shows counts and times but no user data. The Slack app's token is a secret that only the developer can set: Devvit encrypts it, and moderators cannot read it.
- **Members of the Slack channel** can read the alerts. The moderators decide who they are.
- **The developer** can read the app's logs.
- **Reddit** runs the platform the app runs on, and **Slack** holds the alerts for the workspace, each under its own privacy policy.

## Deletions

- **A post or comment deleted on Reddit.** When Reddit reports the deletion, the app takes the content's title and text out of every alert still waiting to be sent, and leaves them out of any alert sent later. Such an alert keeps a link without the title. The app keeps only the content's ID, for a day. In alerts already in Slack, it replaces each alert that quotes the content, sent within the channels' retention (the **Slack Message Retention** setting, at most 90 days), with the same alert without the title and text, by editing it; where the workspace does not allow the edit, it deletes the alert. Alerts older than that, or sent before the app could do this, keep the content until Slack's retention removes them, or the moderators delete them. The alert about a deleted post links to it without its title, and does not name its author.
- **A deleted Reddit account.** Reddit does not tell apps when an account is deleted. A deleted account's username stays, as metadata, in the ban and mute history until that expires, and in alerts already in Slack until the workspace's message retention removes them. The terms ask moderators to keep alerts for no more than 90 days, and for 30 where their Slack plan allows it.

## Choices

- **Moderators** choose which actions send alerts, can leave mod notes out of alerts, can turn any modqueue alert off by setting its threshold to 0, and can uninstall the app at any time. Excluding a moderator stops alerts about their actions; their actions still count toward activity spikes, and bans and mutes they issue are still recorded while unban or unmute alerts are on, so that unbans keep their context. Turning unban and unmute alerts off stops the ban and mute history. **Slack Message Retention** sets how long the app remembers where its alerts are in Slack.
- **Redditors** cannot opt out of a subreddit's moderation tools. To ask what the app holds about you, or to ask for it to be removed, message u/ivashkin on Reddit. Alerts already in a subreddit's Slack are for that subreddit's moderators to delete: ask them.

## Children

Reddit is for people aged 13 and over. The app is a tool for moderators, and is not directed at children.

## Copies run by others

The app's code is open source. Anyone who deploys their own copy of it is that copy's developer, and this policy does not cover it.

## Changes

This policy is kept in the app's [GitHub repository](https://github.com/ivashkin-reddit/mod-action-notifications), whose history records every change to it. The date at the top says when it last changed.

## Contact

Message u/ivashkin on Reddit about anything in this policy. For questions that involve no personal data, you can also [open an issue on GitHub](https://github.com/ivashkin-reddit/mod-action-notifications/issues); issues are public.
