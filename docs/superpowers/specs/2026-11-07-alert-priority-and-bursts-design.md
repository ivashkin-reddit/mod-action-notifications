# Urgent alerts first, and removal bursts in one message: design

**Status:** agreed with the owner on 7 November 2026.
**Background:** [the observability and load pass](../../reviews/2026-11-06-observability-load-pass.md), and the question of how the app behaves on a subreddit as busy as r/ukpolitics during an election.

## Goal

On a busy subreddit, ordinary moderation stays well inside what the app handles. What it cannot handle is a burst of removals: each removal is its own Slack message, the outbox delivers one message every 1.1 seconds (about 54 a minute), and every alert waits in one queue behind the others.

- A moderator removing 200 items in a minute queued 152 alerts in the load harness's storm scenario. The last arrived about three minutes after the first.
- Removing 600 comments from a brigaded thread overflows the queue's 500 places, and the oldest alerts are dropped.
- A security alert, a Reddit admin's modmail or an urgent report queued behind 500 alerts waits about nine minutes. A hijacked moderator account removing everything causes both the burst and the security alert, so its warning is the one delayed.

This design makes two changes:

1. **Urgent alerts first.** Every Alert Channel message is delivered before any Notification Channel message waiting with it.
2. **Removal bursts in one message.** Once a moderator is removing at the spike rate, their further removals are counted, and one summary replaces them.

Each part is built and passes CI on its own. Part 1 comes first.

## What the owner decided

- **Urgent means the Alert Channel:** every message the app already routes there. That covers security alerts, unknown moderators, admin modmail and modmail waiting, urgent reports and pile-ups, queue and monitor alerts, deleted posts, and edits after approval. The rule holds when both channel settings name the same channel.
- **Two queues, alerts drained first (approach A1).** Rejected: one queue with urgency in the score, whose score also means "when queued" for the one-day expiry, the oldest-waiting check and the cap. Also rejected: pacing each channel separately (A3), which gives no priority when the channels are the same, the default.
- **Only removals are combined:** `removelink`, `removecomment`, `spamlink`, `spamcomment`. Bans and unbans keep their own messages, as each carries the ban's length and the user's recent history. Security actions are never combined.
- **Reddit's own accounts are combined too:** u/reddit (Crowd Control and the filters) and Anti-Evil Operations (admins' removals), so an admin sweep of a thread is one summary, not hundreds of messages. Their alerts keep the Reddit style, and the spike label stays on human moderators' alerts only. AutoModerator's removals are not combined.
- **The summary quotes nothing.** It gives counts by type, the time span and a link to the mod log filtered to the moderator.
- **Hold and summarise (approach B1).** Rejected: one live message edited as the count grows (B2), whose edits notify nobody and which needs a new update path. Also rejected: merging what waits in the outbox (B3), which still sends about one message a second during a burst.
- **Progress summaries give running totals**, not counts since the last summary. The final summary gives the burst's total.
- **No setting.** Bursts are always on. A quiet subreddit rarely reaches five actions a minute.

## Part 1: urgent alerts first

### Two queues

| Queue              | Key                         | Holds                                                                                                                               |
| ------------------ | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Alert queue        | `slack_outbox_alerts` (new) | every message for the Alert Channel                                                                                                 |
| Notification queue | `slack_outbox` (existing)   | every message for the Notification Channel: routine mod actions, the daily summary, the weekly digest, and part 2's burst summaries |

- **Format and expiry.** Both queues store members in today's format and expire after the same day (`MAX_AGE_SECONDS`).
- **Separate caps.** Each queue has its own cap of 500. A message that overflows a queue pushes out that queue's oldest message only, so a flood of notifications never costs an alert.
- **Upgrade.** Members already in `slack_outbox` when an installation upgrades are delivered from the notification queue, whatever their channel. They wait at most a day, and no migration is needed.

### Delivery order

- **One pace.** Each drain step sends the oldest alert, else the oldest notification, else makes the oldest redaction. Both queues share one pace of 1.1 seconds, because the two channels may be one channel.
- **Unchanged.** The lease, the continuation and recovery drains, retries, and the check of each message against deleted content before it is sent all stay as they are.

### Deleted content

- **Both queues.** `forgetContent` rewrites the quoting messages in both queues. A rewritten message keeps its place in its own queue.
- **Queuing.** The check made when an alert is queued (`enqueueQuoting`) applies to both.

### How adapters choose a queue

- **The outbox's `send` names the queue.** `composition.ts` builds two senders from it, each a `SlackSender` tied to a channel and a queue:
    - `alerts` puts the message and its version without quotes in the Alert Channel, and queues it in the alert queue;
    - `notifications` puts both in the Notification Channel, and queues it in the notification queue.
- **Adapters stop taking channel names and stop calling `inChannel`.** Each is given the senders for where it posts:
    - **Alerts only:** reports, modmail, the modqueue monitor, deleted posts, the security watch, and edits after approval.
    - **Notifications only:** the daily summary and the weekly digest.
    - **Both:** the mod-action adapter, which keeps its rule. An unknown moderator's action, or a security action while Security Alerts is on, goes to `alerts`; everything else goes to `notifications`.
- **No mismatch is possible.** No adapter can post to the Alert Channel through the notification queue.
- **Direct sending is unchanged.** The direct sender (Simulate Mod Action, Test Slack Connection) is untouched. When queuing fails, the outbox still sends the message straight to Slack.

### Health and Show Bot Status

- **A full queue.** A drop from either queue notes `alert-dropped` and raises `outbox-full` as today, and the outbox's log line names the queue.
- **Status.** `queueState` returns each queue's waiting count and oldest time. Show Bot Status shows two rows, "Alerts waiting" and "Notifications waiting", in place of the single "Alerts waiting".

## Part 2: removal bursts in one message

### What moderators see

- **Before the spike.** Removals alert one by one, as now, until the moderator's actions reach the spike: 5 or more of any kind within 60 seconds (`ACTIVITY_SPIKE_ACTIONS`, `ACTIVITY_WINDOW_MS`).
- **The opening removal.** The first removal that alerts at the spike opens the burst. It is sent as now, with its spike label and one more line: _"Further removals by u/{moderator} will be summarised."_
- **Later removals.** Further removals at the spike rate are counted, not sent.
- **The final summary** goes to the Notification Channel once a minute passes with no further removal by them: _"Removal burst: u/{moderator} removed {n} comments and {m} posts ({k} of them as spam) between {opened} and {last}."_ It ends with a link to `https://old.reddit.com/r/{subreddit}/about/log/?mod={moderator}`.
    - The count includes the opening removal.
    - Times use the Slack date format other alerts use.
    - The username passes through `escapeText`.
- **Progress summaries.** While the burst lasts, a progress summary goes every 5 minutes with the running totals so far, marked _"still going"_.
- **Closing.** After the final summary the burst is over. The moderator's next removal alerts on its own again, until another spike opens a new burst.
- **A burst that held nothing.** If no removal followed the opening one, the burst closes without a summary: the opening alert already said everything.
- **Reddit's own accounts** burst the same way, with three differences:
    - their opening alert has no spike label;
    - the burst line and the summary name the account in plain text, not as the `u/` profile link a moderator gets: no profile has the name;
    - the summary links to the unfiltered mod log, as a filter for Reddit's accounts can't be checked in a playtest.

### Which removals join

A removal joins a burst only when all of these hold:

- it is reported (`isReported`);
- its actor is `"moderator"` or `"reddit"`, not `"unknown-moderator"`;
- its type is one of the four removals;
- it carries an activity spike.
    - `activityOf` no longer skips Reddit's accounts, so their actions count toward the activity window as a moderator's do.
    - The Slack adapter shows the spike label only for the `"moderator"` actor.
    - AutoModerator's actions are still skipped, so they never carry a spike and never join.

Activity counting feeds nothing but the spike, so counting Reddit's accounts changes no other alert.

It joins only after it has claimed its ID (`isFirstDelivery`), so a removal Devvit delivers twice is counted once. Every removal is still counted in the team statistics.

### Where it lives

All of it is in the moderation module:

- **`domain/burst.ts`** holds the pure rules:
    - which action types are removals;
    - the quiet period (60 seconds) and the progress interval (5 minutes);
    - whether a scheduled run waits, sends progress or closes, and when the next run is due;
    - whether a burst's summary is overdue.
- **`application/`.** `notifyModAction` gains the burst branch, and a new use case, `summariseBurst`, does a scheduled run. `ports.ts` gains:
    - burst records (join, read, close, note progress and the next due time);
    - a burst schedule (run the summary at a time);
    - `reportBurst` on `ModActionAlerts`, for the opening line and the summaries.
- **`infrastructure/`:**
    - the Redis burst records;
    - a scheduler adapter for the job;
    - the summary messages in the Slack mod-action adapter, sent through `notifications`.
- **The composition root** registers the `removalBurst` job in `main.ts` through `invokedJob`, and `scheduledJobs.ts` runs `summariseBurst`.

### What is stored

| Key                                                       | Kind     | Holds                                                                                                                                                                                         | Kept                                  |
| --------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `mod_actions:burst:{subreddit}:{moderator}`               | metadata | a hash: `opened` and `last` (when the app handled the first and latest removal), `due` (when the summary job next runs), `progressAt` (the last progress summary), one count per removal type | an hour after its last write          |
| `mod_actions:burst_closing:{subreddit}:{moderator}:{due}` | metadata | the same hash while it is summarised                                                                                                                                                          | deleted once read; expires in an hour |
| `mod_actions:burst_run:{subreddit}:{moderator}:{due}`     | metadata | the claim of one scheduled run                                                                                                                                                                | an hour                               |
| `mod_actions:burst_rescue:{subreddit}:{moderator}:{due}`  | metadata | the claim of one rescue, keyed by the overdue `due` (or `opened` when there is none)                                                                                                          | an hour                               |

`{moderator}` is the acting account: a moderator, or one of Reddit's accounts. Subreddit and account parts are normalised as `activityKey` does. No key holds content, a mod note or a user ID.

### Joining a burst

A removal that joins runs one Redis transaction: `watch` on a key nothing writes, then `multi`, the commands and `exec`. A key no one writes means concurrent removals never abort each other's transactions. The commands:

1. `HSETNX opened {now}`: 1 when this removal opens the burst.
2. `HINCRBY {type} 1`.
3. `HSET last {now}`.
4. `EXPIRE` an hour.
5. `HGET due` and `HGET opened`.

The transaction runs whole either before or after a closing rename, so no count is lost to a run that closes the burst.

Whoever schedules a run (the opening removal, a rescue or a run itself) writes the run's time to `due` first, then schedules it. A run that starts at once then finds its own `due` in the hash, not a stale one.

- **The removal that opens the burst** writes `due` as a minute from now, and schedules `removalBurst` then, with `{ subredditName, moderatorName, due }`. Then it sends its alert with the burst line.
    - If scheduling fails, it deletes the hash, logs a warning (`[burst]`) and sends its alert without the burst line. The next removal at the spike tries again.
- **Any other removal** is counted, and nothing is sent.
    - If the summary is overdue, it claims a rescue (`SET NX`), writes `due` as now and schedules the job for now. Overdue means more than a minute past `due`, or, with no `due` yet, more than two minutes past `opened`.
    - A rescue whose scheduling fails leaves the summary overdue, and the next removal rescues it again under a new claim.
    - So a lost job delays a summary, and never loses the burst.

### A scheduled run

1. It claims its run (`burst_run` with its `due`, `SET NX`). A run Devvit delivers twice does nothing the second time.
2. It reads the hash.
    - **No hash.** The burst has closed or expired, and the run does nothing.
    - **Stale run.** If the hash has a `due` other than the run's, a later run or a rescue has taken over, and this run does nothing.
3. **Quiet** (a minute or more since `last`): it closes the burst.
    - It renames the hash to `burst_closing` with its `due`, reads that, deletes it and sends the final summary, unless the burst held no removal after the opening one.
    - Removals after the rename find no hash, so a removal at the spike opens a new burst.
4. **Still going:**
    - If 5 minutes have passed since `progressAt`, or since `opened` when there's been no progress summary, it sends a progress summary and writes `progressAt`.
    - It writes `due` as the earlier of a minute after `last` and the next progress time, then schedules the next run for it.
    - If scheduling fails, it closes the burst at once, with a final summary, so no burst stays open with nothing to end it.
5. **Errors.** It logs any failure with `[burst]`, and resolves, as every scheduler job does.

During a burst the job runs about once a minute, well within Devvit's 60 one-off jobs a minute per installation.

## Testing

**Unit tests.** Each is checked against a deliberate break in the code it covers.

- **Outbox:**
    - alerts leave before notifications;
    - each queue's cap drops only its own messages;
    - deleted content is rewritten in both queues, each message in its own;
    - `queueState` reports each queue;
    - the senders put a message and its version without quotes in their channel and queue.
- **`domain/burst.ts`:** wait, progress or close; the next due time; overdue; no summary for a burst that held nothing.
- **`notifyModAction`'s burst branch,** with the moderation ports in `tests/fixtures/moderationPorts.ts`:
    - opens;
    - holds;
    - doesn't open when scheduling fails;
    - opens and holds for Reddit's accounts too, without the spike label;
    - leaves unknown moderators, AutoModerator, bans and non-spike removals alone;
    - a duplicate delivery is counted once.
- **The Redis burst records,** against the fake Redis. The fake gains `watch`, `multi` and `exec`, `rename` and `hSetNX`.

**Integration tests**, through the fake Devvit, with timers driven by the harness:

- 20 removals in quick succession produce 5 single alerts, the fifth with the burst line, and one summary a minute after the last;
- a burst lasting 12 minutes sends progress summaries at 5 and 10 minutes, with running totals;
- an Anti-Evil Operations sweep of 20 removals is combined the same way, in the Reddit style, without a spike label, its summary linking the unfiltered mod log;
- a Reddit admin's modmail queued behind 100 notifications is delivered first;
- a summary job delivered twice sends one summary;
- a lost summary job is rescued by the next removal;
- the new keys and the `removalBurst` job name are pinned, as stored data;
- `devvit.json` and `main.ts` still match.

**Dependency budgets.** [dependencyBudgets.test.ts](../../../tests/integration/dependencyBudgets.test.ts) is updated on purpose: a held removal costs fewer Redis calls than queuing an alert, a drain step reads one queue more, and an action by one of Reddit's accounts is now counted toward the activity window.

**Load harness:**

- The invariants and the driver read both queues, each bounded at 500.
- The real-Redis adapter answers `watch`, `multi` and `exec`, `rename` and `hSetNX` in Devvit's shapes, and `realRedis.load.test.ts` checks them.
- Re-run:
    - the storm, where 152 alerts should become about 6 messages;
    - the ramp, to see where the breaking point moves.
- Extend the storm with a few Alert Channel events and record how long they wait.

## Documentation

- **README:** a burst of removals is summarised, and Alert Channel alerts are delivered first.
- **OPERATORS-GUIDE:**
    - the two queues and their order;
    - how a burst opens, is counted, summarised and closed, for moderators and for Reddit's accounts;
    - the new keys in "Data stored";
    - the two rows in Show Bot Status;
    - troubleshooting a burst that never summarised.
- **PRIVACY-POLICY:** the burst record, the acting account's name (a moderator's or one of Reddit's) with counts and times, kept an hour.
- **AGENTS.md:**
    - the moderation module's Redis keys (`mod_actions:burst*`);
    - the outbox bullet: two queues, alerts first;
    - the adapters bullet: adapters are given senders tied to their channel and queue.
- **[Playtest runbook](../../playtest-runbook.md),** a new step. A moderator removes 6 or more items within a minute, and checks:
    - five alerts arrive, the fifth with the burst line;
    - a summary arrives a minute after the last removal;
    - the mod log link opens the log filtered to them.

    During that backlog they change a moderator's permissions, and the security alert arrives before the remaining removals.

## Out of scope

- Bursts by AutoModerator.
- Bans and unbans in bursts.
- Pacing each channel separately (A3); it can be added on top of the two queues if throughput ever matters.
- A setting to turn bursts off.

## Risks and open questions

- **Who counts as an unknown moderator.** The mod list doesn't lag. The app uses its cached copy only to confirm a moderator, and looks a missing name up in the live list, so a new moderator is recognised on their first action. Reddit's two accounts are recognised by name.
- **Devvit app accounts.** Community reports, not Reddit's docs, say an installed app's account is added to the mod list with full permissions. If so, a "nuke thread" app's removals count as a moderator's and are combined. Runbook step 14 confirms which account Reddit names for an app's actions.
- **Admins under other names.** An admin acting under any name but Reddit's two accounts would be an unknown moderator, whose removals are security alerts and never combined. Nothing seen so far says Reddit does this.
- **The mod log link.** `?mod=` is old Reddit's filter. The playtest checks that it filters by moderator.
- **Transactions.** Transactions are new to this app. The load harness checks their shape against real Redis, and the playtest step exercises them on Devvit.
