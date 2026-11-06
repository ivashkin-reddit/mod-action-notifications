# Terms & Conditions

**App:** Mod Action Notifications (Devvit app `ukpolitics-man`)  
**Developer:** u/ivashkin  
**Effective:** 5 November 2026

These terms are between the developer and the moderators of a subreddit where the app is installed. Installing or configuring the app means accepting them. Redditors do not use the app, and these terms do not bind them; the [Privacy Policy](./PRIVACY-POLICY.md) says what happens to their data.

## 1. What the app is

A free moderation tool that tells a subreddit's mod team, in their Slack workspace, about mod actions, a modqueue that is backing up, and popular posts deleted by their authors. It reads and reports. It never removes, approves, bans or posts anything, and writes to Reddit only to send the subreddit's modmail notices about its own problems. It is not listed in Reddit's App Directory, and is installed only on subreddits its developer moderates.

## 2. Using it

Use the alerts only to moderate the subreddit, and in line with Reddit's [User Agreement](https://www.redditinc.com/policies/user-agreement), the [Reddit Rules](https://www.redditinc.com/policies/reddit-rules) and the [Moderator Code of Conduct](https://www.redditinc.com/policies/moderator-code-of-conduct). Do not use them to harass, track or expose redditors, or share them beyond the people who moderate the subreddit.

## 3. Your Slack workspace

The moderators choose the Slack workspace and channel the alerts go to. They are responsible for who can read that channel and for how long Slack keeps its messages.

The app posts through a Slack app that the developer installs in the workspace. It may only post, and only to the channels it has been added to. The developer keeps its token secret, and replaces it if it leaks.

Alerts quote Reddit content and name redditors. When content an alert quotes is deleted on Reddit while the alert is within the retention set in the app's **Slack Message Retention** setting (at most 90 days), the app edits the alert in Slack to leave it out, or deletes the alert where it cannot be edited. Keep the alert channels' messages for no more than 90 days, and set **Slack Message Retention** to the same number of days, so that no alert outlives the app's ability to do this. Where your Slack plan lets you set retention for a channel, keep them for 30 days, as Reddit recommends for data about redditors: Reddit does not tell the app when an account is deleted, so this is how a deleted account's username leaves Slack.

## 4. No guarantees

The app is free and provided as it is, without warranty. It depends on Reddit and on Slack, and an alert may be late, sent twice, or never sent. Do not rely on it as the only way to learn of activity in the subreddit. **Show Bot Status** and the modmail notices show when it is not working.

## 5. Liability

As far as the law allows, the developer is not liable for any loss that comes from using the app or from its not working. Nothing in these terms limits a liability the law does not allow to be limited.

## 6. Changes and ending

The developer may change, pause or withdraw the app at any time, and Reddit may disable it. The moderators may uninstall it at any time. Uninstalling removes the app's records and settings; alerts already in Slack and notices already in modmail stay.

Changes to these terms are dated at the top, and recorded in the history of the app's [GitHub repository](https://github.com/ivashkin-reddit/mod-action-notifications). Continuing to use the app after a change means accepting it.

## 7. The code

The app's source code is published under the [MIT License](./LICENSE), which covers the code. These terms cover the app as its developer runs it. Anyone who deploys their own copy is that copy's developer, and these terms do not cover it.

## 8. Reddit's terms

Reddit's own terms and policies apply to everything on Reddit, alongside these terms.

## 9. Contact

Message u/ivashkin on Reddit, or [open an issue on GitHub](https://github.com/ivashkin-reddit/mod-action-notifications/issues).
