# Moderator workflow alerts and team statistics: design

**Status:** agreed with the owner on 6 November 2026; the defaults marked _to confirm_ are proposals.
**Plans:** [roadmap](../plans/2026-11-06-moderator-workflow-alerts-roadmap.md), and one plan per phase.

## Goal

Tell the mod team, in Slack, about the moments in their work that the app now misses: changes to the team and its tools, urgent and piling reports, modmail that needs them, content edited after approval, and a ban's context. Give the team weekly statistics about its moderation as a whole.

## What the owner decided

- **Statistics are team-level only.** No digest, form or alert shows a figure per moderator. Stores that must tell moderators apart to count them hold a one-way hash of the username, never the name.
- **Security alerts** cover changes to the mod team and its permissions, Devvit apps installed or changed, a moderator account that wakes after a long silence, edits to AutoModerator's config, and a rule that misfires after such an edit.
- **Urgent report reasons and admin modmail** alert at once.
- **From the list of new alerts:** security-relevant mod actions (1), spam and edited queue sizes (7), unanswered modmail (2), edits after approval (3), report pile-ups (4), and, for ban alerts, the user's recent mod-note history (6).
- **Out of scope:** per-moderator statistics, hot-thread and brigade detection, breaking-news bursts, reposts of removed links, and per-user watchlists.

## Rules every feature follows

These restate the project's rules (AGENTS.md) as they bear on this work.

- **Records hold metadata only.** Metadata is the record of moderation: action types, IDs of posts, comments, actions and conversations, times, counts, ban lengths, usernames as the moderator who acted or the user acted on. No record holds content (what redditors write), a mod note, or a Reddit user ID (`t2_`). AutoModerator's rule reasons and the configured urgent report reasons are text moderators wrote as configuration; they are kept only where a feature counts by them, and documented as such.
- **New alerts quote nothing.** They link to posts and comments without the title in the link (`withoutTitle`), so content deleted on Reddit never needs redacting from them.
- **Each alert is claimed** by the event it is about (`SET NX`, for a day or its throttle period) before it is queued, so an event Devvit delivers twice alerts once.
- **Alerts wait on Slack's setup:** without a bot token and a notification channel, a feature records what it must and sends nothing.
- **Setting names and Redis keys are permanent** once released; tests pin them.
- **Every change updates** README, the Operators Guide, the privacy policy (anything newly read, stored or sent) and AGENTS.md (module table, keys).

## Features

Each feature lists what it reads, what it keeps, and its settings. Channel: **alert** is the Alert Channel (falling back to the notification channel); **notification** is the Notification Channel.

### F1. Security-relevant mod actions

- **Catalog additions**, offered under Enabled Mod Actions: `setpermissions`, `wikirevise`, `createrule`, `editrule`, `deleterule`, `reorderrules`, `edit_post_requirements`, `dev_platform_app_installed`, `dev_platform_app_uninstalled`, `dev_platform_app_enabled`, `dev_platform_app_disabled`, `dev_platform_app_changed`.
- **Security actions:** `addmoderator`, `removemoderator`, `invitemoderator`, `acceptmoderatorinvite`, `setpermissions`, and the five `dev_platform_app_*` actions. While **Security Alerts** is on they are always alerted, as security alerts in the alert channel, whatever Enabled Mod Actions and Excluded Moderators say. While it is off they follow Enabled Mod Actions like any other action.
- **Reads:** the mod action events the app already receives. **Keeps:** nothing new.
- **Setting:** `securityAlerts`, boolean, default on.

### F2. Spam and edited queue sizes

- The modqueue monitor also reads Reddit's spam queue and edited queue, and alerts when either holds at least its threshold, at most once an hour each.
- **Keeps:** throttle claims `mod_actions:throttle:modqueue_spam` and `mod_actions:throttle:modqueue_edited` (1 hour).
- **Settings:** `spamQueueThreshold` and `editedQueueThreshold`, whole numbers, default 0 (off) _to confirm_.

### F3. Recent history in ban alerts

- A ban alert gains a line counting the banned user's entries in Reddit's mod notes from the days before the ban, by kind: removals, spam removals, bans, mutes and notes. Never their text. The ban's own note (made in the same second) is left out.
- **Reads:** `reddit.getModNotes({ subreddit, user, limit: 100 })`, only for a ban that is alerted. **Keeps:** nothing.
- **On failure** the alert goes without the line, and a warning is logged.
- **Setting:** `banHistoryDays`, whole number, default 30; 0 leaves the line out.

### F4. A dormant moderator account wakes

- The app keeps when each moderator last took an action. A moderator's first action after at least the configured number of days alerts as a security alert: "u/X took their first action in N days". A moderator the app has not seen act since it was installed is not alerted on. Removing a moderator forgets them.
- **Keeps:** `security:last_action`, a hash of moderator username to time (metadata); claims `security:woke:{moderator}` (1 day).
- **Setting:** `dormantModeratorDays`, whole number, default 90; 0 turns it off. Also off while Security Alerts is off.

### F5. AutoModerator config edits, and a rule that misfires

- On a `wikirevise` action, the app reads the latest revision of `config/automoderator`. If it was made by the acting moderator within two minutes of the action, it sends a security alert: who edited it, the revision's reason, and how many lines were added and removed, with a link to the page's revision history. It never shows the config's text.
- **Misfire check:** after an AutoModerator config edit, the app compares AutoModerator's removals in the hour since the edit with its hourly average over the 24 hours before. At least 20 removals and at least five times the average sends one alert: "AutoModerator removed 64 items in the hour after u/X edited its config (average 6 an hour)".
- **Reads:** `getWikiPageRevisions` and `getWikiPage` for `config/automoderator`. **Keeps:** `security:automod_hourly` (AutoModerator removals per hour, 2 days), `security:automod_edit` (the last edit's time and editor, 1 day), claims `security:misfire:{editTime}` (1 day).
- **Setting:** under Security Alerts.

### F6. Urgent report reasons

- On a post or comment report, if the report's reason contains one of the configured reasons (ignoring case), an alert goes to the alert channel at once, naming the configured reason that matched, with a link and the report count. A free-text reason a user typed is never shown.
- **Reads:** `PostReport` and `CommentReport` events. **Keeps:** claims `reports:urgent:{itemId}` (1 day).
- **Setting:** `urgentReportReasons`, text, comma-separated, default empty (off).

### F7. Report pile-ups

- When a post's or comment's report count reaches the threshold, one alert goes to the alert channel, with the count and a link. Items whose reports moderators chose to ignore are skipped.
- **Keeps:** claims `reports:pileup:{itemId}` (1 day).
- **Setting:** `reportPileUpThreshold`, whole number, default 0 (off) _to confirm_.

### F8. Modmail from Reddit's admins

- On a modmail message, the app reads the conversation; if the message's author is a Reddit admin, an alert goes to the alert channel at once, with the conversation's subject and a link to it.
- **Reads:** `ModMail` events, `reddit.modMail.getConversation`. **Keeps:** claims `modmail:admin:{messageId}` (1 day).
- **Setting:** `adminModmailAlerts`, boolean, default on.

### F9. Unanswered modmail and ban appeals

- On each monitor run, the app lists conversations in the New, In Progress and Appeals folders. A conversation whose last message is from a user and at least the configured hours old counts as waiting. One alert, at most every six hours, gives how many wait and the oldest's age, with ban appeals counted apart, and a link to the modmail inbox.
- **Reads:** `reddit.modMail.getConversations`. **Keeps:** the throttle claim `modmail:throttle:waiting` (6 hours).
- **Setting:** `modmailWaitHours`, whole number, default 0 (off) _to confirm_. The monitor job is scheduled while this or any modqueue threshold is on.

### F10. Edits after approval

- When a moderator approves a post or comment, the app remembers the approval. If the author then edits it within the configured days, an alert goes to the alert channel: who edited, who approved and how long before, with a link. Neither version of the text is shown.
- **Reads:** `PostUpdate` and `CommentUpdate` events, approval mod actions. **Keeps:** `approved_edits:approved:{itemId}` (approver and time, for the configured days), claims `approved_edits:alerted:{itemId}` (1 day).
- **Setting:** `editsAfterApprovalDays`, whole number, default 7 _to confirm_; 0 turns it off.

### F11. Team statistics

- **Counted from every mod action** (each once, by its ID): actions by type and by who took them (moderators, AutoModerator, Reddit); moderators' actions by hour of day; bans (temporary, permanent, total length) and unbans; removals per thread; how many distinct moderators acted.
- **Weekly digest** to the notification channel, Monday 08:00 UTC, when **Weekly Statistics** is on: totals and change from the week before, the split by who acted, the top action types, hours with no moderator action and the busiest hour, ban figures, moderators active (a count), and the five most-moderated threads (links without titles).
- **Show Team Stats** menu item: the same figures for the last 7 days and today, as a form.
- **Keeps:** `stats:actions:{day}`, `stats:hours:{day}`, `stats:bans:{day}` (hashes of counts, 15 days), `stats:threads:{day}` (post ID to removal count, top 100, 15 days), `stats:active:{day}` (hashes of moderator usernames, 15 days), claims `stats:counted:{actionId}` (1 day) and `stats:digest:{week}` (8 days).
- **Setting:** `weeklyStatistics`, boolean, default off.

### F12. Team statistics: response times and outcomes

- **Time to act:** from a post's or comment's first report, or its AutoModerator filter, to a moderator removing or approving it, in buckets (15 minutes, 1, 4, 12 and 24 hours, longer), with the median read from them.
- **Outcomes:** the share of reported items removed and approved; for each AutoModerator rule, how many of its filtered items moderators approved (its false positives); how often moderators reverse Reddit's own removals; how often one moderator reverses another (a team count).
- **Modmail first response:** from a user's first message to a moderator's first reply.
- **Reads:** report events, `AutomoderatorFilterPost` and `AutomoderatorFilterComment` events, mod actions, modmail events. **Keeps:** `stats:awaiting` (item ID to when it entered the queue, 7 days, at most 10,000), `stats:awaiting_rule` (item ID to AutoModerator's rule reason), `stats:reddit_removed` and `stats:human_removed` (item IDs, with a hash of the remover for the latter, 1 day), `stats:modmail_waiting` (conversation ID to time, 7 days), and daily hashes of bucket counts and outcomes (15 days).
- Shown in the weekly digest and Show Team Stats.

## Defaults to confirm with the owner

| Setting                                      | Proposed default |
| -------------------------------------------- | ---------------- |
| `spamQueueThreshold`, `editedQueueThreshold` | 0 (off)          |
| `reportPileUpThreshold`                      | 0 (off)          |
| `modmailWaitHours`                           | 0 (off)          |
| `editsAfterApprovalDays`                     | 7                |
| `dormantModeratorDays`                       | 90               |
| `banHistoryDays`                             | 30               |

## Facts to confirm in a playtest

- The app's account can read mod notes, and Devvit's `getModNotes` does not reject notes made by mod actions (its mapping asserts fields that Reddit may leave empty).
- A `wikirevise` action fires for an edit to `config/automoderator`, and the page's latest revision is readable when it does.
- `getConversation` marks admins (`isAdmin`) among a conversation's authors.
- Whether the `ModMail` event's `conversationId` and `messageId` carry the prefixes `ModmailConversation_` and `ModmailMessage_` (the protobuf says not; the app takes them off either way), and whether an admin's message comes with `messageAuthorType` `participant_user`.
- Whether `getConversations` lists the most recently updated conversations first, so a full folder leaves out the longest waits.
- Report events carry the item's report count, and reasons arrive as the rule's or Reddit's wording.
- `PostUpdate` and `CommentUpdate` fire for edits by authors, with the edited item's ID, and `previousBody` holds the text before the edit (a post's `selftext`).
