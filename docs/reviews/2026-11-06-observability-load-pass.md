# Observability, reliability, performance and load-testing pass

Date: 6 November 2026. Branch `observability-load-pass`, stacked on `pre-v1-fixes`. SDK: `@devvit/public-api` 0.15.2 (Blocks).

The sprint since the last pushed commit (`origin/main`, dd39996) added seven features, a pre-v1 review and per-subreddit Slack connections: 24 commits, 192 files, about 12,000 lines. This pass asks where the app, now doing much more per event, becomes slow, expensive, opaque or fragile, and at what event rate it breaks.

The app is a notifier. It takes no moderation action on Reddit: it reads moderation events and sends alerts to Slack, and notices to the subreddit's modmail. The prompt's requirements about removals, bans and their audit trail therefore apply to its alerts and notices: never alert twice for one event, never alert on the app's own output.

## Platform limits used

Checked on 6 November 2026 against the Devvit docs for 0.15 (developers.reddit.com, through Context7 and the docs' source in reddit/devvit-docs) and the installed SDK.

| Limit                                  | Documented value                                                                       | Where                                     |
| -------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| Redis storage                          | 5 GB per installation                                                                  | capabilities/server/redis, guides/faq     |
| Redis request size                     | 5 MB                                                                                   | same                                      |
| Redis throughput                       | 40,000 commands per second per installation                                            | same                                      |
| Redis transactions                     | 30 concurrent blocks per installation, 5-second execution timeout (the app uses none)  | same                                      |
| `zRange` by score or lex               | at most 1,000 members per call                                                         | capabilities/server/redis, zRange         |
| Scheduler                              | 10 live recurring jobs; `runJob` 60 created and 60 delivered a minute per installation | capabilities/server/scheduler             |
| HTTP fetch                             | 30-second timeout                                                                      | capabilities/server/http-fetch            |
| Settings                               | 2 KB per value                                                                         | guides/faq                                |
| Execution time, Devvit Web             | 30 seconds a request                                                                   | devvit-web overview; the Redis guide too  |
| **Execution time, Blocks handlers**    | **not documented**                                                                     | none: 30 s is assumed here                |
| **Reddit API rate limit (`context.reddit`)** | **not documented** for Devvit apps                                               | none                                      |
| Trigger delivery                       | at least once, in no guaranteed order; handlers run concurrently                       | capabilities/server/trigger-events, redis |

Two facts shape the observability design:

- Devvit keeps an installation's logs for 7 days, up to 5,000 entries: about 30 lines an hour.
- Devvit's settings client (0.15.2) answers `settings.get(name)` by calling `getAll()`, a full `GetSettings` call, every time (`@devvit/settings/SettingsClient.js`).

## 1. Sprint delta inventory

### Handlers

All twelve triggers, four scheduler jobs, six menu items and three working forms are registered in `src/main.ts`. Each is a thin wrapper around an exported handler.

| Handler                                         | Runs                    | New or changed this sprint                                                                     |
| ----------------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `ModAction` (`alertOnModAction`)                | per mod action          | changed: now also counts statistics, runs the security watch, remembers approvals             |
| `PostDelete`, `CommentDelete`                   | per deletion            | changed: redact alerts already in Slack, a page at a time                                       |
| `PostReport`, `CommentReport`                   | per report              | new: urgent reasons, pile-ups, time to act                                                      |
| `AutomoderatorFilterPost`, `…Comment`           | per AutoModerator hold  | new: time to act                                                                                |
| `PostUpdate`, `CommentUpdate`                   | per edit                | new: edits after approval                                                                       |
| `ModMail`                                       | per modmail message     | new: admin messages, reply times                                                                |
| `AppInstall`, `AppUpgrade`                      | per install or upgrade  | changed: also schedules the weekly statistics                                                   |
| job `modqueueMonitor`                           | every 15 minutes        | changed: spam and edited queues, modmail waiting                                                |
| job `slackOutbox`                               | after each drain        | changed                                                                                         |
| jobs `dailySummary`, `weeklyStatistics`         | daily, weekly           | `weeklyStatistics` new                                                                          |
| menu: Connect Slack, Show Team Stats            | per moderator click     | new                                                                                             |
| menu: Test Slack Connection, Show Bot Status, Simulate Mod Action, Setup Modqueue Monitoring | per moderator click | changed                                                               |

### Hot path map

Expected invocations per minute in a busy subreddit, from the event mix the load generator uses (`tests/load/events.ts`). Comment edits and deletions dominate, then mod actions (AutoModerator's among them), then reports. The app registers no trigger for new posts or comments.

Predicted costs per invocation, from reading the code, against what the meter measured:

PREDICTIONS_TABLE

Costs that scale with something other than the event:

- **The outbox's inline drain.** A mod action that alerts delivers the queue in the same invocation, at Slack's pace of 1.1 seconds a message, for up to 10 seconds.
- **Removing deleted quotes.** At the end of a drain, every queued alert that quotes content is checked against `slack_outbox_deleted`, every post and comment deleted on the subreddit in the past day. That set has no bound.
- **The modqueue monitor.** Every 15 minutes it reads every page of the modqueue, unmoderated and reports listings: pages grow with the queue.
- **Unknown accounts.** A mod action by an account not on the cached mod list refetches the whole mod list.
- **The AutoModerator config diff.** It compares line counts: quadratic in the config's distinct lines.

### Reddit API calls

Per invocation, most handlers make none: the trigger payload carries what they need. The exceptions:

- `banuser` (mod log, 10 entries);
- a reported ban (mod notes, 100);
- an unknown account (the mod list);
- `wikirevise` (two revisions, and up to two page reads);
- `PostDelete` (`getPostById`, for the score, absent from the payload);
- `ModMail` from a non-moderator, with admin alerts on (`getConversation`: the payload has no admin flag);
- the monitor (six listings and three modmail folders);
- menu items (`forModerators`: the current user and their permissions).

### Moderation side effects

There are none on Reddit. The app's outward effects are Slack posts, edits and deletions (claimed by event ID, so an event delivered twice alerts once), modmail notices (claimed per condition per day), and scheduler jobs.

### Rules evaluated per event

The rules are:

- urgent report reasons, matched as case-insensitive substrings;
- excluded moderators and enabled actions, matched by equality;
- AutoModerator's config, compared line by line.

No regular expression is built from settings or wiki content: the only regular expressions are fixed literals. Rule-set stress testing (scenario 7 of the prompt) therefore has nothing to stress.

### Existing instrumentation

Before this pass:

- **Coverage.** The app logged failures and lasting problems (health conditions, once when they start, daily, and when they end) under area tags, and nothing about invocations that succeeded.
- **What was missing.** There was no timing, no correlation, no count of operations, and no record of what an invocation decided. An event that arrived and did nothing left no trace. One line named the moderator of an unknown account's action.

## 2. Observability

OBSERVABILITY_SECTION
