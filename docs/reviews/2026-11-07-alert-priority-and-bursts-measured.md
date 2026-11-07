# Urgent alerts first, and removal bursts: measured

**What was measured:** the code before this branch (78c14ff, the code of c003c70) against the code after it, on the load harness ([tests/load/](../../tests/load), run by hand with `npm run load`), against real Redis 7.4 in Docker, on the same seeded events. The harness, its scenarios and how to read its results are in [the observability and load pass](2026-11-06-observability-load-pass.md#5-load-results). The design is in [the spec](../superpowers/specs/2026-11-07-alert-priority-and-bursts-design.md).

## The scenarios

- **Storm.** 200 mod actions in a minute, spread over the harness's ten moderators, about 19 each: removals, approvals, AutoModerator removals, bans, locks and flair edits, in the steady mix's proportions. Three security alerts (a moderator's permissions changed) are fired 15, 30 and 45 seconds in.
- **Nuke** (new). One moderator removes 600 comments in three minutes, as in clearing a brigaded thread. Three security alerts are fired 30, 90 and 150 seconds in.

Each scenario waits up to two minutes after its events for the queues to drain and every scheduled job to run, then checks its invariants.

## Results

|                         | Storm, before          | Storm, after        | Nuke, before                       | Nuke, after |
| ----------------------- | ---------------------- | ------------------- | ---------------------------------- | ----------- |
| Events                  | 192                    | 192                 | 592                                | 592         |
| Slack messages          | 155                    | 85                  | 279 sent, 316 still queued         | 9           |
| Security alerts' wait   | 24.7 s, 52.0 s, 83.8 s | 1.3 s, 2.0 s, 1.4 s | 67.4 s, then two not sent in time  | 0.01 s each |
| Failed invocations      | 0                      | 0                   | 0                                  | 0           |
| Longest invocation      | 11.0 s                 | 10.9 s              | 11.1 s                             | 4.4 s       |
| Bytes read from Redis   | 1.37 MB                | 0.40 MB             | 13.4 MB                            | 1.8 MB      |
| Redis commands a second | 57                     | 57                  | 114                                | 82          |
| Invariants              | all hold               | all hold            | the outbox not drained: 316 queued | all hold    |

What they show:

- **A security alert no longer waits for the backlog.**
    - Before, it joined the end of one queue: 25 to 84 seconds in the storm. In the nuke, the second and third were still waiting when the scenario ended, behind more than five minutes of removals.
    - After, it went before every notification waiting, in one to two seconds in the storm. In the nuke there was no backlog to overtake, so each went at once.
- **One moderator's run of removals is a handful of messages.**
    - The nuke's 592 removals were 9 messages: four single alerts before the spike, the alert that opened the burst, its summary, and the three security alerts.
    - Before, it was a message for each removal, at Slack's pace of one every 1.1 seconds: about eleven minutes of Slack messages, 316 of them still queued when the scenario ended.
- **The storm's saving is smaller, and why.** The storm spreads its actions over ten moderators, about 19 each in the minute. Each moderator's first few actions alert on their own before their burst opens, and bans alert on their own. So it went from 155 messages to 85, not to a handful.
- **The work behind the messages is smaller too.**
    - Bytes read from Redis fell to under a third in the storm, and from 13.4 MB to 1.8 MB in the nuke: a held removal reads its burst, not the queue.
    - The longest invocation in the nuke fell from 11.1 seconds, a drain working through the backlog, to 4.4 seconds.

## The ramp

Each step is a fresh installation, given a minute of the steady mix at the rate: edits, deletions, reports, modmail, and mod actions over ten moderators. The harness then waits up to two minutes for the queues to drain.

| Events a minute | Failed, before / after | Worst p95, before / after | Redis commands a second, before / after | Invariants, before / after |
| --------------- | ---------------------- | ------------------------- | --------------------------------------- | -------------------------- |
| 60              | 0 / 0                  | 1.1 s / 1.1 s             | 10 / 10                                 | all hold / all hold        |
| 150             | 0 / 0                  | 6.7 s / 6.7 s             | 28 / 19                                 | all hold / all hold        |
| 300             | 0 / 0                  | 10.3 s / 10.1 s           | 51 / 36                                 | all hold / all hold        |
| 600             | 0 / 0                  | 10.7 s / 10.7 s           | 57 / 67                                 | all hold / all hold        |
| 1,200           | 0 / 0                  | 10.6 s / 10.7 s           | 103 / 98                                | 124 queued / 2 queued      |

- **Where it breaks.** By the harness's rule, which needs the queues empty two minutes after the minute ends, both still break at 1,200 events a minute.
- **How far it breaks.** Before, 124 alerts were still waiting; after, 2. In the steady mix many of the alerts are one moderator's removals, which a burst summarises.
- **Why the ceiling stays.** Edits after approval, reports and bans still alert one by one, so Slack's pace of about 54 messages a minute is still the limit for them.
- **Redis.** Commands a second rose at 600 events a minute, from 57 to 67. Each removal held in a burst runs its transaction, and the burst jobs run. The highest, 98 a second, is still far under Devvit's limit of 40,000.

## Measured in the integration suite

- **Redis calls a removal costs** (pinned in [dependencyBudgets.test.ts](../../tests/integration/dependencyBudgets.test.ts)):
    - 39 for a removal held in a burst, its transaction's nine calls counted (`redis.tx.*`);
    - 71 for one alerted, with its share of the drain;
    - 11 for a comment deletion.

    Every look at the queues reads the alert queue first, which added one call to a deletion and five to an alerting mod action.

- **A burst of 20 quick removals** gives 5 single alerts, the fifth with the burst line, and one summary a minute after the last.
- **A burst of 12 minutes** gives progress summaries at about 5 and 10 minutes, then its total.

## Not measured

- **Devvit's own Redis transactions.** The load harness runs the transaction on real Redis through node-redis's MULTI, and checks Devvit's result shapes against it. Whether Devvit's `watch` with a key nothing writes, and its `exec`, behave so in production is for the playtest (runbook step 15).
- **The mod log link's filter.** `?mod=` is old Reddit's; the playtest checks it.
