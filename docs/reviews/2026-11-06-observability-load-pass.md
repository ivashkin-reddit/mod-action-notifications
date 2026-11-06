# Observability, reliability, performance and load-testing pass

Date: 6 November 2026. Branch `observability-load-pass`, stacked on `pre-v1-fixes`. SDK: `@devvit/public-api` 0.15.2 (Blocks).

The sprint since the last pushed commit (`origin/main`, dd39996) added seven features, a pre-v1 review and per-subreddit Slack connections: 24 commits, 192 files, about 12,000 lines. This pass asks where the app, now doing much more per event, becomes slow, expensive, opaque or fragile, and at what event rate it breaks.

The app is a notifier. It takes no moderation action on Reddit: it reads moderation events and sends alerts to Slack, and notices to the subreddit's modmail. The prompt's requirements about removals, bans and their audit trail therefore apply to its alerts and notices: never alert twice for one event, never alert on the app's own output.

## Platform limits used

Checked on 6 November 2026 against the Devvit docs for 0.15 (developers.reddit.com, through Context7 and the docs' source in reddit/devvit-docs) and the installed SDK.

| Limit                                        | Documented value                                                                       | Where                                     |
| -------------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| Redis storage                                | 5 GB per installation                                                                  | capabilities/server/redis, guides/faq     |
| Redis request size                           | 5 MB                                                                                   | same                                      |
| Redis throughput                             | 40,000 commands per second per installation                                            | same                                      |
| Redis transactions                           | 30 concurrent blocks per installation, 5-second execution timeout (the app uses none)  | same                                      |
| `zRange` by score or lex                     | at most 1,000 members per call                                                         | capabilities/server/redis, zRange         |
| Scheduler                                    | 10 live recurring jobs; `runJob` 60 created and 60 delivered a minute per installation | capabilities/server/scheduler             |
| HTTP fetch                                   | 30-second timeout                                                                      | capabilities/server/http-fetch            |
| Settings                                     | 2 KB per value                                                                         | guides/faq                                |
| Execution time, Devvit Web                   | 30 seconds a request                                                                   | devvit-web overview; the Redis guide too  |
| **Execution time, Blocks handlers**          | **not documented**                                                                     | none: 30 s is assumed here                |
| **Reddit API rate limit (`context.reddit`)** | **not documented** for Devvit apps                                                     | none                                      |
| Trigger delivery                             | at least once, in no guaranteed order; handlers run concurrently                       | capabilities/server/trigger-events, redis |

Two facts shape the observability design:

- Devvit keeps an installation's logs for 7 days, up to 5,000 entries: about 30 lines an hour.
- Devvit's settings client (0.15.2) answers `settings.get(name)` by calling `getAll()`, a full `GetSettings` call, every time (`@devvit/settings/SettingsClient.js`).

## 1. Sprint delta inventory

### Handlers

All twelve triggers, four scheduler jobs, six menu items and three working forms are registered in `src/main.ts`. Each is a thin wrapper around an exported handler.

| Handler                                                                                      | Runs                   | New or changed this sprint                                                        |
| -------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------- |
| `ModAction` (`alertOnModAction`)                                                             | per mod action         | changed: now also counts statistics, runs the security watch, remembers approvals |
| `PostDelete`, `CommentDelete`                                                                | per deletion           | changed: redact alerts already in Slack, a page at a time                         |
| `PostReport`, `CommentReport`                                                                | per report             | new: urgent reasons, pile-ups, time to act                                        |
| `AutomoderatorFilterPost`, `…Comment`                                                        | per AutoModerator hold | new: time to act                                                                  |
| `PostUpdate`, `CommentUpdate`                                                                | per edit               | new: edits after approval                                                         |
| `ModMail`                                                                                    | per modmail message    | new: admin messages, reply times                                                  |
| `AppInstall`, `AppUpgrade`                                                                   | per install or upgrade | changed: also schedules the weekly statistics                                     |
| job `modqueueMonitor`                                                                        | every 15 minutes       | changed: spam and edited queues, modmail waiting                                  |
| job `slackOutbox`                                                                            | after each drain       | changed                                                                           |
| jobs `dailySummary`, `weeklyStatistics`                                                      | daily, weekly          | `weeklyStatistics` new                                                            |
| menu: Connect Slack, Show Team Stats                                                         | per moderator click    | new                                                                               |
| menu: Test Slack Connection, Show Bot Status, Simulate Mod Action, Setup Modqueue Monitoring | per moderator click    | changed                                                                           |

### Hot path map

Expected invocations per minute in a busy subreddit, from the event mix the load generator uses (`tests/load/events.ts`). Comment edits and deletions dominate, then mod actions (AutoModerator's among them), then reports. The app registers no trigger for new posts or comments.

Predicted costs per invocation, from reading the code, against what the meter measured:

| Handler (share of events)           | Predicted Redis                                              | Measured Redis, mean (max) | Predicted settings | Measured | Reddit, predicted; measured                                         |
| ----------------------------------- | ------------------------------------------------------------ | -------------------------- | ------------------ | -------- | ------------------------------------------------------------------- |
| `CommentUpdate` (30%)               | 1 connection read, then the approval if the text changed     | 2 (2)                      | 24                 | 25       | none; 0                                                             |
| `CommentDelete` (20%)               | 10                                                           | 10 (10)                    | none               | 0        | none; 0                                                             |
| `ModAction` (25%)                   | about 29 without an alert; 69 for an alerted comment removal | 59.2 (69)                  | 24                 | 25       | from the payload, except bans, wiki edits and unknown accounts; 0.2 |
| `CommentReport`, `PostReport` (12%) | 3 or 4; about 31 with an alert                               | 12.0 (31), 13.2 (31)       | 24                 | 25       | none; 0                                                             |
| `AutomoderatorFilterComment` (5%)   | 2 or 3                                                       | 2.8 (3)                    | none               | 0        | none; 0                                                             |
| `PostUpdate` (3%)                   | as `CommentUpdate`                                           | 2 (2)                      | 24                 | 25       | none; 0                                                             |
| `PostDelete` (3%)                   | 11                                                           | 11 (11)                    | 24                 | 25       | `getPostById`; 1                                                    |
| `ModMail` (2%)                      | 3 to 5                                                       | 3.8 (5)                    | 24                 | 25       | `getConversation` for a user's message; 0.5                         |
| job `slackOutbox`, nothing queued   | 14                                                           | 14                         | 24                 | 25       | none; 0                                                             |
| job `modqueueMonitor`, one alert    | 8, plus 26 an alert                                          | 35                         | 24                 | 25       | the listings; 4 calls                                               |
| job `weeklyStatistics`              | 84 reads, plus an alert                                      | 114                        | 24                 | 25       | none; 0                                                             |

Measured one event at a time on the load harness at volume 1, before any change. Every count is within its prediction. The one discrepancy, 25 settings calls against 24, is this pass's own Debug Logging setting. The meter counts a Reddit listing as the call that made it, so the monitor's 4 hides its pages.

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

### The completion line

Every handler `main.ts` registers now runs as an invocation (`src/invocations.ts`). The handler's Devvit APIs (`redis`, `reddit`, `settings`, `scheduler`) and Slack's `fetch` are wrapped in a meter (`src/meter.ts`). The meter is a proxy that counts and times every call, including nested clients such as `reddit.modMail`. To count Slack calls per invocation, the Slack module now takes a `SlackApi` (the token and a fetch) in place of a bare token: a global `fetch` can't be attributed to one of several concurrent invocations.

Each invocation ends with one line, `[invocation] {…}`. Its fields are listed in [OPERATORS-GUIDE.md](../../OPERATORS-GUIDE.md#reading-the-logs): a correlation id, the handler, subreddit and target IDs, the outcome and duration, each dependency's calls and time, failed calls, alerts sent, the slowest call and the last, and for a failure a stable `code`, `class` and `stage`. A sample from the load harness:

```text
[invocation] {"id":"3zmltfgq","handler":"ModAction","subreddit":"t5_testsub","target":"t1_c","outcome":"ok","ms":1100,"redis":{"n":66,"ms":0},"reddit":{"n":0,"ms":0},"settings":{"n":1,"ms":0},"scheduler":{"n":0,"ms":0},"slack":{"n":1,"ms":0},"failedCalls":0,"alerts":1,"slowest":"redis.hSet 0ms","lastCall":"redis.hGet","eventBytes":993}
```

That is a mod action that alerted, the second of two back to back. Its 1,100 ms are not in any call: the outbox waited for Slack's pace. The difference between `ms` and the dependencies' time is the app's own time, waits included.

A failure, from the integration tests (Redis failing as the connection is read):

```text
[invocation] {"id":"wk1ryejw","handler":"ModAction","subreddit":"t5_testsub","target":"t3_abc","outcome":"failed","ms":0,"redis":{"n":5,"ms":0},"reddit":{"n":0,"ms":0},"settings":{"n":1,"ms":0},"scheduler":{"n":0,"ms":0},"slack":{"n":0,"ms":0},"failedCalls":1,"alerts":0,"slowest":"redis.hSet 0ms","lastCall":"redis.get","error":{"code":"redis-failed","stage":"redis.get","class":"Error"},"message":"redis down","eventBytes":1335}
```

### When it is logged, and why not always

The prompt asks for one line per invocation. Devvit keeps 5,000 log lines a week per installation, about 30 an hour. At a busy subreddit's 30 events a minute, a line per event would push every error out of the log within three hours. So:

- **Always:** a failed invocation logs its line (ERROR), and so does a slow one, of 20 seconds or more (WARN). Each is held to one a minute per handler, counting those held back: an outage that fails every event logs a line a minute, not one an event.
- **Debug Logging:** a new subreddit setting, off by default. While it's on, every invocation logs its line (INFO). Turning it on for one subreddit during an incident needs no deploy.
- **Settings-free invocations:** a comment deletion or an AutoModerator hold reads no settings, so it follows Debug Logging as its installation last read it, kept in the process.

Lines carry ids, counts and times. Neither content nor usernames: the one line that named an account (an unknown moderator's action) no longer does. A condition's detail, which comes from Reddit, Slack or the network, is cut to 200 characters where it's raised, as it also goes to modmail notices and Show Bot Status.

### Correlation, and its limit

The correlation id ties a completion line to its invocation. Lines logged inside a handler, such as `[security] Could not watch a mod action`, don't carry it: adding it would mean passing a logger to every module, or AsyncLocalStorage. The SDK uses AsyncLocalStorage itself, but no doc says an app may. The completion line names the failed call (`stage`) and counts failed calls even when the handler caught them, so the two lines can be matched by time and area.

### Audit trail

The app takes no moderation action, so it writes no mod log entries or mod notes. Moderators see what it did in Slack (each alert) and in modmail (notices of problems that last). They can't see what it decided not to alert on, and the app doesn't promise that.

### Transactions

The app uses no Redis transactions: every write is a single atomic command (claims with `SET NX`, counters with `INCRBY`/`HINCRBY`, sorted sets). There is no retry rate to record.

### Health signals

The table in [OPERATORS-GUIDE.md](../../OPERATORS-GUIDE.md#reading-the-logs) gives each signal, where it's read, what normal looks like on the load harness, and what indicates a problem. That includes the one that shows the app silently not alerting: mod actions arriving with none alerted, and no condition in force.

## 3. Reliability findings

None of these could have caused a wrong or duplicate moderation action: the app takes none. The guarantees it does keep (one alert per event delivered twice, no alert on content after its deletion, no deleted content left in Slack) held in every load scenario's invariant checks (section 5).

| #   | Weakness                                                                   | Failure sequence                                                                                                                                                                                                                                                                                                                                       | Fix                                                                                                                | Regression test                                                                                                      |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| L1  | An outbox run that found Slack not set up kept its "drain scheduled" claim | A drain scheduled a later run, Slack was disconnected, and the run found nothing to send. It returned without releasing the claim. For up to 46 seconds after, every new drain looked already scheduled and none ran, including the one Connect Slack schedules, so queued alerts waited for the next alert.                                           | The run releases the claim first. Committed with the per-subreddit Slack work (1e60282), found while measuring it. | `slackOutboxNotConnected.test.ts`, "lets a later drain be scheduled once a run has found it so"                      |
| L2  | Condition details had no length cap                                        | A Reddit, Slack or network error message became a condition's detail, in full, in the log, a modmail notice and Show Bot Status.                                                                                                                                                                                                                       | Cut to 200 characters where every condition is raised.                                                             | `healthLog.test.ts`, "is logged with at most 200 characters of what the failure said"                                |
| L3  | A username in the logs                                                     | An action by an account not on the mod list logged the account's name.                                                                                                                                                                                                                                                                                 | The line keeps the action, not the name. The alert names the account for the moderators.                           | `modActionFiltering.test.ts`, "is sent as a security alert to the alert channel"                                     |
| L4  | Removing deleted quotes read every deletion of the day                     | A drain ending with quoting alerts still queued, or a deletion finding the queue free, read all of `slack_outbox_deleted`. That is every post and comment deleted in a day, with no bound: 4 MB at 200,000 deletions, near the 4 MB message limit of common gRPC clients. Past it, the read, and with it the drain, would fail, and alerts would wait. | Each queued alert's own content is looked up instead (section 6, O3).                                              | `outbox.deletions.test.ts`, "is looked up by what queued alerts quote, however many deletions there were"            |
| L5  | Settings-free invocations could not be debugged                            | A comment deletion or an AutoModerator hold reads no settings, so it never saw Debug Logging, and never logged its line.                                                                                                                                                                                                                               | It follows the setting as its installation last read it.                                                           | `invocations.test.ts`, "is logged for an invocation that reads no settings, while Debug Logging was last read as on" |

Each test failed before its fix. The deliberate breaks of this pass (the settings read, the edit order, the debug fallback, the line limit, content in the line) were each caught by a test.

Reviewed and found sound, with no change:

- **At-least-once delivery.** Every alert path claims its event's ID with `SET NX` before sending. The duplicates scenario delivered every event twice, some out of order, and posted the same alerts as delivering each once (section 5).
- **Concurrency.** No read-then-write remains on a shared key. Counters are `INCRBY`/`HINCRBY`, claims `SET NX`, and take-once entries `HGET` then `HDEL`, counting only for the handler whose `HDEL` returns 1. No transaction exists to leak.
- **Dependency failure.** A Reddit call that fails leaves the handler's state consistent:
    - **Unknown account.** The mod list can't be read, so the account counts as a moderator's: no false security alert.
    - **Ban length or mod notes.** The alert goes without them.
    - **`PostDelete`'s score.** No deleted-post alert is considered.
    - **The monitor.** A condition is raised.

    Redis failing rejects the handler, and its completion line says which call failed. Nothing retries in a loop: the outbox retries Slack three times in a drain, then waits for a scheduled run.

- **Misconfiguration fails closed.** Settings that can't be read fall back to the last read, then to defaults that name no channel: nothing is sent.
- **Scheduler jobs.** Each job's work is bounded:
    - **Monitor.** Listings of at most about a thousand items.
    - **Weekly statistics.** 14 days of keys, each capped.
    - **Outbox.** A 10-second budget and a 500-alert queue.
    - **Daily summary.** Two hashes.

    Overlapping runs are safe: the outbox has a lease, the others claim their period.

Open, for the playtest (step 14 of the runbook):

- **The app's own installs and upgrades.** Reddit logs them as `dev_platform_app_*` mod actions, which the security watch alerts on. If Reddit names the app's own account, which isn't on the mod list, each upgrade sends a false "unknown moderator" alert. The fix would be to ignore the app's account (`context.appAccountId`). It waits on evidence. Severity: low (one alert per upgrade).
- **The app's own modmail notices.** Whether they come back as ModMail events, or count as a conversation waiting for a reply, is not documented. Severity: low (a waiting alert at most, after 24 hours).

## 4. Performance baseline

Each handler one event at a time, 20 events of each kind, on the load harness at volume 1, before any change (commit b281f42). Jobs ran once each at volumes 1, 10 and 100. The same seeded events were run again after the optimisations (commit b5f032f): the last two columns give what changed. Reddit and Slack calls and alerts were the same, and durations within 10 ms. Locally, Redis answers in under a millisecond, and the Reddit, Slack and settings fakes answer at once. The durations below are therefore the app's own work plus Slack's pacing, and say nothing about the platform's latency.

| Handler                      | Events | p50 / p95 / max, ms | Redis, mean (max) | Reddit | Slack | Alerts | Settings, before → after | Redis after |
| ---------------------------- | ------ | ------------------- | ----------------- | ------ | ----- | ------ | ------------------------ | ----------- |
| `CommentUpdate`              | 20     | 1 / 1 / 1           | 2                 | 0      | 0     | 0      | 25 → 0                   | 1           |
| `CommentDelete`              | 20     | 4 / 5 / 5           | 10                | 0      | 0     | 0      | 0                        | 10          |
| `ModAction`                  | 20     | 1105 / 1117 / 1117  | 59.2 (69)         | 0.2    | 0.9   | 17     | 25 → 1                   | 59.2 (69)   |
| `CommentReport`              | 20     | 2 / 1111 / 1111     | 12 (31)           | 0      | 0.3   | 6      | 25 → 1                   | 12 (31)     |
| `AutomoderatorFilterComment` | 20     | 1 / 2 / 2           | 2.8 (3)           | 0      | 0     | 0      | 0                        | 2.8 (3)     |
| `PostUpdate`                 | 20     | 1 / 1 / 1           | 2                 | 0      | 0     | 0      | 25 → 0                   | 1           |
| `PostDelete`                 | 20     | 4 / 5 / 5           | 11                | 1      | 0     | 0      | 25 → 1                   | 11          |
| `PostReport`                 | 20     | 2 / 1111 / 1111     | 13.2 (31)         | 0      | 0.4   | 7      | 25 → 1                   | 13.2 (31)   |
| `ModMail`                    | 20     | 1 / 2 / 2           | 3.8 (5)           | 0.5    | 0     | 0      | 25 → 1                   | 3.8 (5)     |
| `slackOutbox`                | 1      | 7 / 7 / 7           | 14                | 0      | 0     | 0      | 25 → 1                   | 14          |

Jobs, one run each at volumes 1, 10 and 100:

| Job                | ms at 1 / 10 / 100 | Redis at 1 / 10 / 100 | Reddit | Slack at 1 / 10 / 100 | Settings, before → after |
| ------------------ | ------------------ | --------------------- | ------ | --------------------- | ------------------------ |
| `modqueueMonitor`  | 15 / 14 / 2230     | 35 / 35 / 139         | 4      | 1 / 1 / 3             | 25 → 1                   |
| `dailySummary`     | 1109 / 1104 / 1094 | 30 / 30 / 30          | 0      | 1 / 1 / 1             | 25 → 1                   |
| `weeklyStatistics` | 1106 / 1100 / 1106 | 114 / 114 / 114       | 0      | 1 / 1 / 1             | 25 → 1                   |
| `slackOutbox`      | 5 / 5 / 6          | 14 / 14 / 14          | 0      | 0 / 0 / 0             | 25 → 1                   |

Notes:

- **Alerting events.** An alerting mod action, report or summary takes about 1.1 seconds: the outbox keeps Slack's pace of one message every 1.1 seconds, and back-to-back alerts wait for it.
- **Everything else.** Under 20 ms.
- **Settings.** Every handler that reads settings made 25 settings calls before the change, each a full `GetSettings` on the platform. That is the largest per-event platform cost the code shows, and local timing can't measure it.

## 5. Load test results

### The harness

`tests/load/` runs the app's real handlers, registered through the same fake `Devvit` as the integration tests, against a real Redis. It is run by hand (`npm run load:redis`, then `npm run load`; `LOAD_SCENARIOS` picks scenarios), not in CI, and writes its results to `load-results/`, which git ignores.

- **Redis.** Redis 7.4 in Docker, through node-redis behind an adapter that answers in Devvit's shapes. `realRedis.load.test.ts` checks the adapter against those shapes first.
- **Reddit, Slack and the scheduler.** The integration tests' fakes, with faults that can be injected: Reddit latency, Reddit rate limiting (HTTP 429), Slack latency and Slack failures (HTTP 503).
- **Events.** A seeded generator (Park and Miller's), so a scenario's events are the same on every run. The steady mix, per 100 events: 30 comment edits, 20 comment deletions, 25 mod actions, 10 comment reports, 5 AutoModerator holds, 3 post edits, 3 post deletions, 2 post reports, 2 modmail messages. The default shape: 2,000 authors, 200 posts, 30% of events on one hot post and 2% from one hot author. Payloads take the shape of Devvit's trigger events.
- **Seeds.** Volume 1 is what a busy installation holds:
    - 2,000 sent-alert entries;
    - 1,000 items awaiting a moderator;
    - 2,000 deletions in the past day;
    - 20 moderators' last actions;
    - 1,000 remembered approvals;
    - 500 threads with removals.

    Volumes 10 and 100 multiply these, up to the bounds the app keeps them to. The fake modqueue listings grow with the volume (5,000 items each at 100).

- **The driver.** Poisson arrivals at a rate, up to a number of concurrent invocations (8, or 32 for the bursts). Events can be delivered twice, and the scheduled jobs run on a period. A one-off job the app schedules, such as an outbox drain, runs when due, as its own invocation.
- **Invariants**, checked in Redis and in the fakes after each scenario:
    - every structure within its bound (queued alerts 500, redactions 5,000, sent-alert entries 100,000, items awaiting 10,000, modmail conversations waiting 10,000);
    - the outbox drained, and no lease left held;
    - no alert posted twice;
    - for the duplicates scenario, the same alerts as when each event came once.

Each scenario ran on the code before the optimisations (b281f42, with the harness fixes below applied) and after them (b5f032f). In the tables, "x / y" is before / after, and a single value is both. Durations are the app's own work and Slack's pace, as section 4 explains.

### Results

| Scenario           | Profile                                                     | Events | Failed invocations | Worst p95, ms | Longest, ms   | Alerts sent | Redis ops/s | Invariants |
| ------------------ | ----------------------------------------------------------- | ------ | ------------------ | ------------- | ------------- | ----------- | ----------- | ---------- |
| Steady             | 30 a minute for 5 minutes, steady mix                       | 164    | 0                  | 3155 / 3169   | 3155 / 3169   | 34          | 9           | all hold   |
| Flood              | 300 a minute for a minute: 5 posts, 50 authors              | 302    | 0                  | 10610 / 10628 | 11081 / 11091 | 92          | 42          | all hold   |
| Storm              | 200 mod actions in a minute                                 | 192    | 0                  | 10650 / 10656 | 10977 / 11002 | 152         | 52 / 56     | all hold   |
| Scheduler          | 60 a minute for 2 minutes, every job every 10 s, volume 100 | 133    | 0                  | 3271 / 3264   | 6471 / 6477   | 36          | 26          | all hold   |
| Growth, volume 1   | 60 a minute for 2 minutes                                   | 133    | 0                  | 3257 / 3256   | 3257 / 3256   | 31          | 17          | all hold   |
| Growth, volume 10  | 60 a minute for 2 minutes                                   | 133    | 0                  | 3248 / 3258   | 3248 / 3258   | 31          | 18 / 17     | all hold   |
| Growth, volume 100 | 60 a minute for 2 minutes                                   | 133    | 0                  | 3248 / 3239   | 3248 / 3239   | 31          | 18 / 17     | all hold   |

Ramp, a fresh installation for each minute at the rate:

| Events a minute | Invocations | Failed | Worst p95, ms | Redis ops/s | Invariants |
| --------------- | ----------- | ------ | ------------- | ----------- | ---------- |
| 60              | 62 / 58     | 0      | 1132 / 1134   | 10          | all hold   |
| 150             | 172 / 167   | 0      | 6699 / 6704   | 29 / 28     | all hold   |
| 300             | 312 / 307   | 0      | 10287 / 10274 | 52 / 51     | all hold   |
| 600             | 634 / 629   | 0      | 10662 / 10666 | 54 / 57     | all hold   |
| 1200            | 1273 / 1268 | 0      | 10637 / 10632 | 92 / 103    | fail       |

Broke at: before 1200 (the outbox drained: 124 queued), after 1200 (the outbox drained: 124 queued).

Degradation, 60 events a minute for a minute in each phase:

| Phase                   | Failed | Worst p95, ms | Alerts sent | Invariants |
| ----------------------- | ------ | ------------- | ----------- | ---------- |
| reddit 500 ms           | 0      | 1132 / 1138   | 10          | all hold   |
| reddit 2 s              | 0      | 2031          | 10          | all hold   |
| reddit 10% rate-limited | 0      | 1125 / 1122   | 10          | all hold   |
| reddit all rate-limited | 0      | 1132          | 10          | all hold   |
| slack 20% failing       | 0      | 5263 / 1341   | 10          | all hold   |
| slack 5 s               | 0      | 11670 / 11652 | 10          | all hold   |

Duplicates: control alerts 23; delivered twice, alerts 23, events 112; invariants all hold.

Soak, 60 events a minute for 30 minutes, in 5-minute windows:

| Window | Worst p95, ms | Heap, MB | RSS, MB | Redis keys  | Redis memory, MB |
| ------ | ------------- | -------- | ------- | ----------- | ---------------- |
| 1      | 1026 / 1029   | 26 / 27  | 92 / 91 | 3256        | 2.91 / 2.99      |
| 2      | 922 / 924     | 28       | 94 / 93 | 3397        | 3.01 / 3.03      |
| 3      | 5578 / 2232   | 30       | 95      | 3498 / 3497 | 3.03 / 3.06      |
| 4      | 1116 / 1127   | 31 / 27  | 97 / 96 | 3583 / 3582 | 3.06 / 3.08      |
| 5      | 4448 / 4459   | 29 / 28  | 97 / 96 | 3667 / 3665 | 3.08 / 3.10      |
| 6      | 1119 / 1127   | 30       | 97 / 96 | 3737 / 3736 | 3.09 / 3.12      |

Soak invariants: all hold.

### What the results show

- **No invocation failed** in any scenario, before or after, including every degradation phase.
- **The invariants held everywhere but in one place.** The ramp's 1,200 events a minute left 124 alerts queued two minutes after the minute ended: the breaking point, section 7.
- **The longest invocations drain the outbox,** inline in an alerting event or as the scheduled job: about 10–11 seconds, the drain's 10-second budget plus its last send. A burst makes them, not a dependency.
- **Duplicates.** Delivering every event twice, some out of order, posted the same 23 alerts as delivering each once.
- **Degradation.**
    - **Reddit slow** (500 ms, 2 s) or **rate-limiting** (10%, all) delays only the handlers that call it. It fails none, and the same 10 alerts went out in every phase.
    - **Slack failing 20% of calls** delays alerts by the outbox's retries and loses none. Its p95 differs between the runs (5,263 against 1,341 ms) because fault injection draws from `Math.random`, so different calls fail in each run.
    - **Slack answering in 5 seconds** stretches a drain to about 11.7 seconds, the worst p95 of any scenario, still well inside the assumed 30-second limit.
- **The scheduler at volume 100.** Every job ran every 10 seconds under the event stream, and no invariant broke. The monitor's runs took at most 37 ms, with their alerts left to the outbox. The longest invocation was a mod action draining the queue, 6.5 seconds.
- **Growth.** The same events at volumes 1, 10 and 100:
    - **Durations.** Each handler's were within a few milliseconds of the others'.
    - **Redis calls.** The same at 1 and 10. At 100 a mod action made 58.9 on average against 57.2: the sent-alert index is at its 100,000 cap there, and each alert remembered forgets the oldest.
    - **Bytes received from Redis:** 81 KB, 444 KB and 503 KB. At volumes 10 and 100 the list of items awaiting a moderator starts at its 10,000 bound, and the first item added prunes it to 9,000. That is one read of the whole list, about 365 KB, which the next 1,000 items don't repeat. The remaining 60 KB at volume 100 wasn't attributed: under 500 bytes an event.
- **Soak.** Over 30 minutes at 60 events a minute, the heap stayed between 26 and 31 MB and the process's memory between 91 and 97 MB, with no upward trend. Redis grew by about 95 keys and 25–35 KB per five minutes: each new alert's records and the day's statistics, kept for the periods OPERATORS-GUIDE.md gives ("Data stored"), none of which ends within 30 minutes. The worst p95s above a second are the outbox's: a drain delivering a run of alerts. A window holds only a few drains, so their p95 moves with timing: window 3's is 5.6 s before and 2.2 s after, on the same events.
- **Before and after differ in the counts, not the outcomes.** Settings calls fell from 25 to 1 per invocation, and to none for most edits. Bytes received from Redis fell 20% in the flood and 37% in the storm, and calls rose in the storm (section 6). Every scenario's alerts and invariants are the same before and after.

### Flaws found in the harness, and fixed

Each would have made a result say something untrue. Each was fixed and the affected scenarios re-run on both trees:

- **RESP3.** node-redis 6 speaks RESP3 by default, and returns sorted-set scores in a different shape. The outbox saw an empty queue: 35 alerts queued, none sent. The adapter now asks for RESP2, and `realRedis.load.test.ts` checks each shape it returns.
- **Duplicate deliveries drew from the arrival stream.** That changed which events arrived (21 alerts against 23). The copies now draw from a random stream of their own, and a check compares the alerts with the control run's. The fix moves every scenario's arrival times, so every scenario was run again on both trees with it, and those are the results above.
- **Failed Slack attempts counted as posts.** The degradation scenario reported "2 repeated" alerts that were retries of a failure. Only messages Slack accepted are counted now (`harness.posted()`).
- **Settings-free invocations before the first settings read.** After O2, an edit to an unapproved item reads no settings, and logs its completion line by Debug Logging as the installation last read it, which a fresh process hasn't. The baseline now starts with an empty outbox run, which reads the settings. In the other scenarios, a few settings-free invocations at the start of each fresh harness go unlogged after the change (2 of 58 edits in the steady run). Per-handler counts there are lower by that much, and event totals come from the driver, not the lines.

## 6. Optimisations

Each was measured before, made as the smallest change, and measured again. The idempotency, atomicity and concurrency tests, the integration suite and the load harness's invariant checks pass after each.

| #   | Measurement before                                                                                                           | Change                                                                                                  | Measurement after                                                  | Tests                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| O1  | 25 settings calls an invocation, for every handler that reads settings. Devvit's `settings.get(name)` fetches every setting. | Read once with `getAll()` (`src/settings/config.ts`)                                                    | 1 call                                                             | `dependencyBudgets.test.ts`; the settings-reading and fallback tests (`config.test.ts`, `modActionFiltering.test.ts`) |
| O2  | An edit: 2 Redis reads and 25 settings calls, before learning whether a moderator approved the item                          | The approval is read first; the settings only for an approved item (`alertOnEdit` takes a lazy `watch`) | An edit to an item nobody approved: 1 Redis read, no settings call | `dependencyBudgets.test.ts`; `editsAfterApproval.test.ts`                                                             |
| O3  | Removing deleted quotes read all of a day's deletions: 4 MB in ~75 ms at 200,000                                             | Each queued alert's own IDs are looked up, at most 500 alerts                                           | Twenty lookups in 7.6 ms; nothing grows with deletions             | `outbox.deletions.test.ts` and the redaction tests                                                                    |

O1 and O2 together: at the steady mix (section 7), settings calls fall from about 610 a minute to about 13, and edits, the most common event, stop reading settings at all.

O3 trades one unbounded read for more small ones. The storm (section 5) shows the trade at its largest, since every drain there ends with quoting alerts queued:

- **Bytes.** Redis bytes received fell from 2.11 MB to 1.32 MB (−37%).
- **Calls.** A drain's mean rose from 131 to 161 Redis calls and its maximum from 230 to 324. A mod action that drained inline peaked at 357, up from 260.
- **Why the trade stands.** A drain's lookups run concurrently (`Promise.all`). They're bounded by what the queue holds, at most 500 alerts. The read they replace grew with every deletion of the day.

O3's first version looked up each alert's IDs separately, and a storm invocation made up to 445 calls. It now looks up each post or comment once. Test: `outbox.deletions.test.ts`, "is looked up once, however many queued alerts quote it".

Considered and rejected, with the measurement against each:

- **Fewer Redis calls in an alerting mod action** (59 on average, up to 83). Most are the outbox's at-least-once and deletion-safety bookkeeping, plus statistics and the security watch. At the steady rate that is about 9 Redis commands a second against the documented 40,000. Batching them would mean restructuring the guarantees the earlier reviews established, for no limit in reach.
- **Reading only part of the monitor's listings.** The age alerts need the oldest items, which come last, so the whole listing is the feature. At volume 100 (5,000 items in each listing) a run took 2.2 seconds, most of it Slack's pace for three alerts.
- **Caching the mod list across invocations.** It is already cached per installation for five minutes. An unknown account refetches it, which a false "unknown moderator" alert would otherwise need.
- **Per-invocation health bookkeeping** (about 6 Redis writes an event: event counts and clearing two conditions). This existed before this pass, and it feeds Show Bot Status and the daily summary. It's left as is: Redis is far from its limits, and the writes are what moderators read.

## 7. Cost model and installation guidance

Dependency calls a minute, measured on the load harness at three event rates with the steady mix: a busy subreddit (30 events a minute), a flood (300 a minute, ten times), and the ramp's last clean step (600 a minute). Each column is shown against the limit it would meet.

| Per minute             | 30 events (steady)                       | 300 events (flood)                             | 600 events (ramp)                          | Limit, Devvit 0.15                                                           |
| ---------------------- | ---------------------------------------- | ---------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------- |
| Redis commands         | about 540 (9 a second)                   | about 2,500 (42 a second)                      | about 3,400 (57 a second)                  | 40,000 a second: under 0.2% at 600 events a minute                           |
| Settings calls, before | about 610                                | about 5,800                                    | about 12,000                               | none documented; each fetches every setting                                  |
| Settings calls, after  | about 13                                 | about 160                                      | about 300                                  |                                                                              |
| Reddit calls           | about 2                                  | about 10                                       | about 20, scaled from the flood            | not documented for Devvit apps                                               |
| Slack calls            | about 7                                  | about 40, while the queue drains               | at Slack's pace, about 54, until it drains | Slack: about 1 message a second to a channel; the outbox keeps 1 every 1.1 s |
| `runJob` calls         | under 1                                  | about 4 (as in the storm: 11 in three minutes) | about 4                                    | 60 created and 60 delivered a minute per installation                        |
| Longest invocation     | 3.2 s (a report's drain of three alerts) | 11.1 s (the drain holding the lease)           | about 11 s (p95 10.7 s)                    | 30 s assumed: not documented for Blocks                                      |

The Reddit calls are the payload's gaps: `getPostById` for a deleted post's score (3% of events), the conversation of a user's modmail (2%), and bans' mod log and notes. They stay small at every rate. The settings calls were the largest per-event platform cost, and O1 and O2 cut them about 40-fold (47 in the steady run, 37 in the flood).

**What fails first, and where.** Slack's pace. The app delivers alerts one every 1.1 seconds, about 54 a minute, whatever the event rate. In the steady mix about one event in five alerts, so alerts outrun delivery above roughly 250 events a minute:

- **A burst** queues the excess, and the queue drains at Slack's pace. The ramp's 600-event minute left a queue that was delivered within the two minutes the harness waits after it.
- **The breaking point.** At 1,200 a minute, 124 alerts were still queued two minutes after the minute ended.
- **Sustained excess** fills the queue's 500 alerts, after which the oldest are dropped and moderators are told (the "alert queue is full" condition).
- **No handler failed** at any rate, none ran past 12 seconds, and every invariant held up to 600 events a minute. At 1,200 a minute, only the drain check failed.

**Installation guidance.**

- **Verified.** The app is verified for subreddits up to about 250 events a minute sustained, where the event rate counts comment edits and deletions, mod actions (AutoModerator's included), reports and modmail. It is also verified for bursts of 600 a minute lasting a few minutes. A busy subreddit sees about 30 a minute; ten times that is a brigade or a viral thread.
- **Above 250 a minute sustained.** Alerts arrive late: by queue length times 1.1 seconds.
- **Above about 10 minutes of excess.** Alerts are dropped, and moderators are told.
- **At volume.** Nothing in the handlers grows with a subreddit's size: every structure they read is bounded, and the growth scenario's handlers ran the same at 1, 10 and 100 times the data.
- **Not measured.** Reddit's rate limit, which isn't documented, and the platform's own latency.

## 8. Limitations

- **Platform limits.** Local load testing can't reproduce Devvit's limits: the execution limit of a Blocks handler, which isn't documented (30 seconds is assumed), the Reddit API rate limit, also not documented, Redis's quotas, or the scheduler's delivery rate.
- **Fakes answer at once.** The fake settings, Reddit and Slack answer immediately unless latency is injected. Local durations show the app's own work and Slack's pacing, not the platform's latency, so the saving from O1 can't be measured locally: its effect is a count, 25 calls to 1.
- **Concurrency.** The harness runs handlers concurrently in one Node process. Devvit may spread them across processes, each with its own in-process state: the mod list cache, the last settings read, Debug Logging's fallback and the line limiter. Each is harmless when lost.
- **Real Redis, not Devvit's.** The harness's Redis is Redis 7.4 in Docker behind an adapter checked against Devvit's shapes, not Devvit's Redis service: its latency, and any difference in its errors, aren't modelled.
- **Not run.** The prompt's scenario 7 (rule-set stress) has nothing to stress: no pattern comes from settings or wiki content.
- **Not playtested.** No playtest was run in this pass. The completion lines in Devvit's log stream, `getAll()` in a Blocks app, and the app's own actions coming back to it are runbook step 14.

## 9. Recommendations

In order of how soon a real subreddit would reach them:

1. **Run the playtest runbook**, step 14 especially. It confirms the completion lines in Devvit's log stream, and settles whether upgrades send a false "unknown moderator" alert. If they do, ignore the app's own account.
2. **After deploy**, check the health signals in the operators guide. For the first day, turn Debug Logging on in one busy subreddit for an hour, and compare its lines with the normal values: settings calls of 1 or 0, Redis calls within the budgets, alerting mod actions near 1.1 s.
3. **Watch the slow lines.** A WARN `[invocation]` line, at 20 seconds or more, means an invocation came near the assumed execution limit. The outbox's inline drain is the likely source when Slack is slow. If they appear, move delivery wholly to the scheduled job.
4. **Watch for a mod action with alerts that never reach Slack.** **Show Bot Status** showing "Last events" recent and "Last alert delivered" old, with no condition in force, means the app has silently stopped alerting.
5. **The open risks from the pre-v1 review stand.** R3, the inline drain against an unknown handler time limit, is now measurable through the slow lines. R11, deletions reading the whole queue during a Slack outage, is bounded by the queue's 500 alerts.
