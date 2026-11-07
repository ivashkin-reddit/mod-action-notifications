# Urgent alerts first, and removal bursts in one message: implementation plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task in the current session. Do the implementation, tests and review yourself. Use subagents only if your human partner explicitly asks for delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Alert Channel messages ahead of Notification Channel ones, and replace a moderator's (or Reddit's) burst of removal alerts with one summary.

**Architecture:**

- **Two queues.** The Slack outbox keeps two Redis sorted sets, and a drain takes from the alert queue first. Capability adapters stop naming channels: `composition.ts` hands each one `SlackSender`s tied to a channel and a queue.
- **Bursts.** The moderation module counts removals at the spike rate in a per-account Redis hash, using a transaction. A one-off scheduler job, `removalBurst`, sends progress and final summaries.

**Tech Stack:** TypeScript 6, Devvit Blocks 0.15.2 (Redis, scheduler), Vitest, ESLint (`all` presets plus boundaries), Prettier, node-redis for the load harness.

**Spec:** [docs/superpowers/specs/2026-11-07-alert-priority-and-bursts-design.md](../specs/2026-11-07-alert-priority-and-bursts-design.md)

## Global Constraints

- **Done.** Every step of `.github/workflows/test.yml` passes: `npm ci`, `npm run typecheck`, `npm run coverage`, `npm run lint`, `npm run format:check`.
- **Stored names are permanent.** These are pinned by tests: `slack_outbox` (the notification queue, unchanged), `slack_outbox_alerts`, `mod_actions:burst:{subreddit}:{account}`, `mod_actions:burst_closing:…:{due}`, `mod_actions:burst_run:…:{due}`, `mod_actions:burst_rescue:…:{due}`, and the job `removalBurst`.
- **Redis state changes atomically.** Use single commands or one `multi`/`exec` transaction, never a read followed by a write.
- **Records hold metadata only.** Burst records hold an account name, counts and times.
- **Logging.**
    - Lines start with their area (`[outbox]`, `[burst]`), never name a user, and never quote content.
    - A scheduler job logs its own failure and resolves.
- **Imports.**
    - Capabilities import neither each other nor `settings`.
    - Only `main.ts` imports `Devvit`.
    - `domain/` imports nothing outside itself.
    - Adapters take `Readonly<Pick<…>>` context types.
- **Workarounds.** Every suppression carries a `WORKAROUND:` block. The only allowed directive is `eslint-disable-next-line` with a `--` reason.
- **Tests.**
    - Each new unit test is checked against a deliberate break in the code it covers.
    - Integration tests reach the app only through what it registers with `Devvit`.
    - Expected mock arguments are written by hand, never with `eslint --fix`.
- **Commits.** Authored as `ivashkin-reddit <ivashkin.r@pm.me>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Check `git config user.name` and `user.email` before each commit.

## File structure

```text
src/slack/
├── queue.ts            # two queues: keys, per-queue cap, oldest across them (alerts first), per-queue state
├── deletions.ts        # enqueueQuoting and removeDeletedQuotes over both queues
├── outbox.ts           # SlackOutbox { alerts, notifications, deliverQueued }
├── message.ts          # + toChannel, directToChannel, SlackDestinations
└── index.ts, delivery.ts
src/health/domain/status.ts      # Show Bot Status: "Alerts waiting" and "Notifications waiting"
src/moderation/
├── domain/burst.ts              # NEW: removal types, quiet and progress rules, overdue, summary counts
├── domain/activity.ts           # activityOf counts Reddit's accounts too
├── application/ports.ts         # + BurstRecords, BurstSchedule, ModActionAlerts.reportBurst, report(…, opensBurst)
├── application/notifyModAction.ts   # + the burst branch
├── application/summariseBurst.ts    # NEW: one scheduled run
├── infrastructure/redisBurstRecords.ts   # NEW
├── infrastructure/devvitBurstSchedule.ts # NEW
└── infrastructure/slackModActionAlerts.ts # destinations, opening line, spike label for moderators only, summaries
src/composition.ts, triggers.ts, communityTriggers.ts, scheduledJobs.ts, menuActions.ts, main.ts
tests/fixtures/fakeRedis*.ts     # + watch/multi/exec, rename
tests/fixtures/fakeScheduler.ts  # + job data
tests/fixtures/app.ts            # + runDueJobs(name)
tests/load/realRedis.ts, invariants.ts, driver.ts, scenarios.load.test.ts
```

---

## Phase 1: urgent alerts first

### Task 1: two queues in `queue.ts`

**Files:**

- Modify: `src/slack/queue.ts`, `src/slack/deletions.ts`, `src/slack/outbox.ts` (callers only)
- Test: `src/slack/outbox.queues.test.ts` (new, by topic)

**Interfaces (produces):**

```ts
export type QueueName = "alerts" | "notifications";
export const QUEUE_KEYS: Readonly<Record<QueueName, string>> = {
    alerts: "slack_outbox_alerts",
    notifications: "slack_outbox",
};
export interface Queued {
    readonly queue: QueueName; /* …as now */
}
export async function enqueue(redis, queue: QueueName, message, quoting): Promise<number>; // dropped from that queue
export async function oldest(redis): Promise<Queued | undefined>; // the alert queue's oldest, else the notification queue's
export async function quotingMessages(redis): Promise<readonly QueuedQuoting[]>; // both queues
export async function remove(redis, queued): Promise<void>; // from queued.queue
export async function replaceWithoutQuotes(redis, queued): Promise<void>; // keeps its queue and score
export type QueueState = Readonly<{ waiting: number; oldestQueuedAt: number | undefined }>;
export async function queueState(redis): Promise<Readonly<Record<QueueName, QueueState>>>;
```

- [ ] **Step 1: write the failing tests** in `outbox.queues.test.ts`, through `createSlackOutbox` as the other outbox tests do:
    - an alert queued after 3 notifications is posted first;
    - 501 notifications drop the oldest notification and leave a queued alert alone;
    - a deleted comment's quote is taken out of a queued alert and a queued notification, each staying in its own queue;
    - `queueState` reports each queue.
- [ ] **Step 2:** run `npx vitest run src/slack/outbox.queues.test.ts` and see them fail.
- [ ] **Step 3:** implement:
    - `enqueue` takes the queue, and caps with `zRemRangeByRank(QUEUE_KEYS[queue], 0, -(MAX_QUEUED + 1))`;
    - `oldest` reads `QUEUE_KEYS.alerts` first;
    - `queuedOf` takes the queue name;
    - `deletions.ts`'s `enqueueQuoting(redis, queue, message, quoting)` passes it on.
- [ ] **Step 4:** run the slack tests: `npx vitest run src/slack`.
- [ ] **Step 5:** commit "Queue Alert Channel messages apart, and deliver them first".

### Task 2: the outbox's senders, by queue

**Files:**

- Modify: `src/slack/outbox.ts` (`SlackOutbox`)
- Modify the call sites: `src/slack/outbox*.test.ts` and `tests/fixtures/outbox.ts`

**Interfaces (produces):**

```ts
export interface SlackOutbox {
    /** Queues the message in the alert queue, delivered before any notification waiting with it. */
    readonly alerts: SlackSender;
    /** Queues the message in the notification queue. */
    readonly notifications: SlackSender;
    readonly deliverQueued: () => Promise<void>;
}
```

- [ ] **Step 1:** the existing outbox tests call `outbox.send(…)`. Rename those calls to `outbox.notifications(…)`, and make the ordering tests from Task 1 use `outbox.alerts`.
- [ ] **Step 2:** implement one private `queueAndDeliver(outbox, queue)`, returning a `SlackSender`, and build both senders from it.
    - A drop raises `outbox-full` with the detail `"alert queue"` or `"notification queue"`.
    - `forgetContent` is unchanged; `oldest` already covers both queues.
- [ ] **Step 3:** `npx vitest run src/slack` passes.
- [ ] **Step 4:** commit, folded into Task 1's commit if it lands together.

### Task 3: senders tied to a channel

**Files:**

- Modify: `src/slack/message.ts`, `src/slack/index.ts`
- Test: `src/slack/message.test.ts`

**Interfaces (produces):**

```ts
/** The two places alerts go: the Alert Channel, delivered first, and the Notification Channel. */
export type SlackDestinations<Send> = Readonly<{ alerts: Send; notifications: Send }>;
/** A sender that puts each message, and its version without quotes, in `channel` before handing it to `send`. */
export function toChannel(channel: string, send: SlackSender): SlackSender;
/** A direct sender that puts each message in `channel`. */
export function directToChannel(channel: string, send: DirectSlackSender): DirectSlackSender;
```

- [ ] **Step 1: failing tests.** `toChannel("alerts", send)` hands `send` the message with `channel: "#alerts"`, and its `withoutQuotes` with the same channel. `directToChannel` does the same and returns what `send` answers.
- [ ] **Step 2:** implement both with `inChannel`, and export them and `SlackDestinations` from `index.ts`.
- [ ] **Step 3:** tests pass.

### Task 4: adapters take senders, not channels

**Files:**

- Modify the adapters:
    - `src/approvedEdits/infrastructure/slackEditAlerts.ts`
    - `src/reports/infrastructure/slackReportAlerts.ts`
    - `src/modmail/infrastructure/slackModmailAlerts.ts`
    - `src/modqueue/infrastructure/slackAlerts.ts`
    - `src/postDeletion/infrastructure/slackAlerts.ts`
    - `src/security/infrastructure/slackSecurityAlerts.ts`
    - `src/health/infrastructure/slackSummary.ts`
    - `src/statistics/infrastructure/slackDigest.ts`
    - `src/moderation/infrastructure/slackModActionAlerts.ts`
- Modify the composition root: `src/composition.ts`, `src/triggers.ts`, `src/communityTriggers.ts`, `src/scheduledJobs.ts`, `src/menuActions.ts`
- Test: `tests/integration/alertsFirst.test.ts` (new)

**Interfaces:**

- `createSlackEditAlerts(send: SlackSender)`, and likewise for reports, modmail, modqueue, post deletion, security (`(send, nameOf)`), summary and digest (`(send, actionNameOf)`). Each drops its channel parameter and its `inChannel` calls.
- `createSlackModActionAlerts(destinations: SlackDestinations<SlackSender>, presentation: ModActionPresentation)`, where `ModActionPresentation` is `{ includeModNote, securityAlerts }`. `modActionMessage` returns `{ message, urgent }`, and `report` sends through `destinations.alerts` when urgent, else `destinations.notifications`.
- `createSlackSimulationAlerts(destinations: SlackDestinations<DirectSlackSender>, presentation)`.
- In `composition.ts`: `slackSendersOf(context, config): SlackDestinations<SlackSender>`, which counts each alert (`context.invocation.noteAlert()`) and applies `toChannel(config.alertChannel, outbox.alerts)` and `toChannel(config.notificationChannel, outbox.notifications)`. `outboxOf` stays for `deliverQueued`.

Steps:

- [ ] **Step 1: failing integration test.** With Slack paced (`drive`), a Reddit admin's modmail fired after 100 queued mod-action alerts is the second message Slack receives. The first is the one the first drain is already sending.
- [ ] **Step 2:** change each adapter and its wiring.
    - Composition passes `senders.alerts` to the alert-only adapters, `senders.notifications` to the summary and the digest, and both to the mod-action adapter.
    - Simulation builds `{ alerts: directToChannel(config.alertChannel, direct), notifications: directToChannel(channel || config.notificationChannel, direct) }`.
- [ ] **Step 3:** `npm run typecheck`, then `npx vitest run tests/integration` passes unchanged apart from the new test. The channels are now applied by the senders.
- [ ] **Step 4:** if no capability imports `inChannel`, drop it from `slack/index.ts`, since its users are inside the slack module.
- [ ] **Step 5:** commit "Hand adapters senders tied to their channel and queue".

### Task 5: Show Bot Status shows each queue

**Files:**

- Modify: `src/health/domain/status.ts` (and `status.test.ts`), `src/menuActions.ts`
- Test: `tests/integration/botStatus.test.ts`

- [ ] **Step 1: failing tests.**
    - `status.test.ts`: input `queue: { alerts: {waiting: 0,…}, notifications: {waiting: 3,…} }` gives "Alerts waiting" "None" and "Notifications waiting" "3".
    - `botStatus.test.ts`: a queued notification shows under "Notifications waiting".
- [ ] **Step 2:** implement.
    - `StatusInput.queue` becomes `Readonly<Record<"alerts" | "notifications", QueueState>> | undefined`.
    - Show two rows. "Unknown: Redis could not be read" appears in both rows when the read fails.
- [ ] **Step 3:** tests pass, and commit "Show the alert and notification queues apart in Show Bot Status".

### Task 6: the load harness and the budgets for phase 1

**Files:** `tests/load/invariants.ts`, `tests/load/driver.ts`, `tests/integration/dependencyBudgets.test.ts`

- [ ] **Step 1.**
    - The invariants bound `slack_outbox` and `slack_outbox_alerts` at 500 each.
    - The drained check covers both queues.
    - The driver's queued count sums both.
- [ ] **Step 2:** run `npx vitest run tests/integration/dependencyBudgets.test.ts`. Update the pinned Redis counts by what the extra read adds, and say so in the test's comment.
- [ ] **Step 3: phase gate.** Every CI step passes. Commit "Read both queues in the load harness; pin the drain's extra read".

---

## Phase 2: removal bursts in one message

### Task 7: the burst rules

**Files:**

- Create: `src/moderation/domain/burst.ts`, `src/moderation/domain/burst.test.ts`
- Modify: `src/moderation/domain/activity.ts` (and `activity.test.ts`)

**Interfaces (produces):**

```ts
export const REMOVAL_TYPES = ["removelink", "removecomment", "spamlink", "spamcomment"] as const;
export type RemovalType = (typeof REMOVAL_TYPES)[number];
export function isRemoval(type: string): type is RemovalType;
/** A minute with no removal ends a burst. */
export const BURST_QUIET_MS = 60_000;
/** While a burst lasts, a progress summary every five minutes. */
export const BURST_PROGRESS_MS = 300_000;
/** A summary this late is scheduled again by the next removal. */
export const BURST_OVERDUE_MS = 60_000;
export type BurstCounts = Readonly<Record<RemovalType, number>>;
export interface Burst {
    readonly opened: number;
    readonly last: number;
    readonly due: number | undefined;
    readonly progressAt: number | undefined;
    readonly counts: BurstCounts;
}
export type BurstStep =
    Readonly<{ kind: "close" }> | Readonly<{ kind: "continue"; progress: boolean; nextDue: number }>;
export function burstStep(burst: Burst, now: number): BurstStep;
export function isOverdue(burst: Pick<Burst, "due" | "opened">, now: number): boolean;
export function removedCount(counts: BurstCounts): number;
/** Whether a burst held removals beyond the one that opened it, so has something to summarise. */
export function heldAny(counts: BurstCounts): boolean; // removedCount > 1
export type BurstTally = Readonly<{ comments: number; posts: number; spam: number }>;
export function tallyOf(counts: BurstCounts): BurstTally;
```

`burstStep`:

- `now - last >= BURST_QUIET_MS` gives `close`.
- Otherwise `progress = now - (progressAt ?? opened) >= BURST_PROGRESS_MS`, and `nextDue = min(last + BURST_QUIET_MS, (progress ? now : progressAt ?? opened) + BURST_PROGRESS_MS)`.

`isOverdue`: `due === undefined ? now - opened > 2 * BURST_QUIET_MS : now - due > BURST_OVERDUE_MS`.

- [ ] **Step 1: failing unit tests.**
    - Quiet at exactly 60 s closes; 59 s continues.
    - Progress at 5 minutes from `opened`, then 5 minutes from `progressAt`.
    - `nextDue` is never after `last + 60 s`.
    - Overdue with and without `due`.
    - A tally of mixed counts.
    - `heldAny` is false for the opener alone.
    - `activityOf` returns a ref for u/reddit and Anti-Evil Operations, and still `undefined` for AutoModerator. This is a deliberate change to an existing test.
- [ ] **Step 2:** implement until they pass, and check each against a deliberate break.
- [ ] **Step 3:** commit "Add the rules of a removal burst; count Reddit's accounts' activity".

### Task 8: fakes for transactions, renames and job data

**Files:** `tests/fixtures/fakeRedis.ts` (or a new `fakeRedisTransactions.ts`), `fakeRedisKeyspace.ts`, `fakeScheduler.ts`, `app.ts`

**Interfaces (produces):**

- `FakeRedis.watch(...keys)` resolves to a fake transaction client with `multi()`, the hash commands, `expire`, `set`, `del`, and `exec(): Promise<unknown[]>`.
    - Commands are queued, and `exec` runs them in one synchronous pass, as each fake command mutates before its first `await`.
    - Results are numbers, strings or `null`, as Devvit's `exec` returns them.
- `FakeRedis.rename(key, newKey)` moves the entry with its expiry, and rejects with `ERR no such key` when the key is absent.
- `FakeScheduler.runJob({ name, runAt, data })` records `data`, and `ScheduledJob` gains `data?`.
- In `app.ts`: `runDueJobs(name)` runs, oldest first, each one-off job of that name whose `runAt` has come, with `{ name, data }`, and removes it from the scheduler.

Steps:

- [ ] **Step 1:** add the fakes. Use them from a short fixture self-test only if a fixture test file already exists; otherwise the burst records' unit tests in Task 10 cover them.
- [ ] **Step 2:** `npm run typecheck`.

### Task 9: ports, the burst branch and the scheduled run

**Files:**

- Modify: `src/moderation/application/ports.ts`, `notifyModAction.ts`, `tests/fixtures/moderationPorts.ts`
- Create: `src/moderation/application/summariseBurst.ts`
- Test: `notifyModAction.test.ts`, `summariseBurst.test.ts`

**Interfaces (produces):**

```ts
/** A burst's account: a moderator, or one of Reddit's accounts. */
export type BurstAccount = ModeratorRef;
export interface BurstJoin { readonly opened: boolean; readonly openedAt: number; readonly due: number | undefined }
export interface BurstRecords {
    /** Counts the removal in the account's burst, opening one when none is open, in one transaction. */
    readonly join: (account: BurstAccount, type: RemovalType, now: number) => Promise<BurstJoin>;
    readonly setDue: (account: BurstAccount, due: number) => Promise<void>;
    readonly read: (account: BurstAccount) => Promise<Burst | undefined>;
    readonly noteProgress: (account: BurstAccount, at: number) => Promise<void>;
    /** Takes the burst out of the way (rename, read, delete) and returns what it held; undefined when none is open. */
    readonly close: (account: BurstAccount, due: number) => Promise<Burst | undefined>;
    readonly discard: (account: BurstAccount) => Promise<void>;
    /** True once for each (account, due). */
    readonly claimRun: (account: BurstAccount, due: number) => Promise<boolean>;
    readonly claimRescue: (account: BurstAccount, overdueSince: number) => Promise<boolean>;
}
export interface BurstSchedule {
    readonly summariseAt: (account: BurstAccount, due: number) => Promise<void>;
}
export interface BurstSummary {
    readonly account: BurstAccount;
    readonly actor: "moderator" | "reddit";
    readonly tally: BurstTally;
    readonly opened: number;
    readonly last: number;
    readonly final: boolean;
}
// ModActionAlerts:
readonly report: (modAction: ModAction, actor: Actor, opensBurst: boolean) => Promise<void>;
readonly reportBurst: (summary: BurstSummary) => Promise<void>;
// ModerationPorts gains: bursts: BurstRecords; burstSchedule: BurstSchedule; and a clock is Date.now().
export async function summariseBurst(account: BurstAccount, due: number, now: number, ports: BurstPorts): Promise<void>;
```

**The burst branch** in `notifyModAction`, after `isFirstDelivery`:

- **Who joins.** An account joins when its actor is `moderator` or `reddit`, its type is a removal, it has an activity spike, and `subredditName` and `moderatorName` aren't blank.
- **Join** (on Redis failure, warn and report as now).
    - **Opened:** `setDue(now + BURST_QUIET_MS)`, then `summariseAt`, then report with `opensBurst: true`. On a scheduling failure: `discard`, warn `[burst]`, and report with `opensBurst: false`.
    - **Not opened:** if overdue and `claimRescue(due ?? openedAt)`, then `setDue(now)` and `summariseAt(now)`, warning on failure. Send nothing.

**`summariseBurst`:**

1. `claimRun`.
2. `read`. Return when there's no burst, or when `due !== undefined && due !== runDue`.
3. On `close`, `close` the burst and `reportBurst(final)` when `heldAny`.
4. On `continue`, report progress and note it when `progress` is due, then `setDue(nextDue)`, then `summariseAt(nextDue)`. When scheduling fails, close and report as in step 3.
5. Errors are left to the job, which logs them.

Steps:

- [ ] **Step 1: failing unit tests**, with `workingPorts` gaining in-memory `bursts` and `burstSchedule`:
    - opens on the spike and reports with the line;
    - holds the next one;
    - Reddit's accounts open too;
    - no burst for unknown moderators, AutoModerator, bans or no spike;
    - a duplicate delivery is counted once;
    - a scheduling failure discards the burst and reports without the line;
    - an overdue summary is rescued once;
    - `summariseBurst`:
        - closes when quiet, with a final summary;
        - closes with no summary when only the opener was counted;
        - sends progress at 5 minutes;
        - a stale run does nothing;
        - a second run with the same due does nothing;
        - closes when rescheduling fails.
- [ ] **Step 2:** implement, and check each test against a deliberate break.
- [ ] **Step 3:** commit "Hold a burst's removals and summarise them from a scheduled run".

### Task 10: the Redis burst records and the schedule adapter

**Files:**

- Create: `src/moderation/infrastructure/redisBurstRecords.ts` (+ `.test.ts`), `src/moderation/infrastructure/devvitBurstSchedule.ts`

**The keys** use `keyPart` as `activityKey` does:

- `mod_actions:burst:{sub}:{account}`;
- `…burst_closing:{sub}:{account}:{due}`;
- `…burst_run:…:{due}`, set NX for an hour;
- `…burst_rescue:…:{since}`, set NX for an hour.

**The transaction** in `join`:

- It watches `mod_actions:burst_tx`, a key nothing writes, so concurrent joins never abort one another.
- Commands: `multi`, `hSetNX(key, "opened", now)`, `hIncrBy(key, type, 1)`, `hSet(key, { last: now })`, `expire(key, 3600)`, `hGet(key, "due")`, `hGet(key, "opened")`, then `exec`.
- It checks that `exec` answered 6 results, and throws otherwise, so the caller reports as now.

**`close`:**

- It renames the hash to the closing key. If `rename` rejects and the hash is gone, it returns `undefined`.
- It `hGetAll`s the renamed hash, then deletes it.
- It parses the counts, ignoring unknown fields.

**The schedule adapter** calls `scheduler.runJob({ name: BURST_JOB_NAME, runAt: new Date(due), data: { subredditName, moderatorName, due } })`, with `BURST_JOB_NAME = "removalBurst"`.

Steps:

- [ ] **Step 1: failing unit tests** against `createFakeRedis()`:
    - two joins: the first opens, and the counts add up;
    - a join after `close` opens a new burst;
    - `close` returns what was counted, and leaves no key;
    - `claimRun` is true once;
    - TTLs are an hour;
    - an `exec` with a missing result rejects.
- [ ] **Step 2:** implement, and export from `moderation/index.ts`.
- [ ] **Step 3:** commit "Keep removal bursts in Redis, counted in one transaction".

### Task 11: the Slack messages

**Files:** `src/moderation/infrastructure/slackModActionAlerts.ts`

- **The opening alert.** When `opensBurst`, the alert gains the line `Further removals by {name} will be summarised` (escaped).
- **The spike label** shows only when the actor is `"moderator"`.
- **`reportBurst`** goes through `destinations.notifications`:
    - text `🧹 Removal burst by {name}`, or `still going` on a progress summary;
    - an attachment with:
        - _Moderator_;
        - _Removed_, as "140 comments and 3 posts (12 of them as spam)";
        - _When_, "{opened} to {last}", or "since {opened}" for progress;
        - _Mod log_ `<https://old.reddit.com/r/{sub}/about/log/?mod={name}|Open the mod log>`, without `?mod=` for Reddit's accounts.
    - Names are URL-encoded in the link and escaped in the text.

Covered by Task 12's integration tests through the fake Slack.

### Task 12: wiring, the job, and integration tests

**Files:**

- Modify: `src/triggers.ts` (`moderationPorts`), `src/scheduledJobs.ts` (`summariseRemovalBurst`), `src/main.ts` (register `removalBurst`), `src/invocations.ts` if a job needs its event (`invokedJob` passes `event` through)
- Test: `tests/integration/removalBursts.test.ts`, `tests/integration/registration.test.ts` (job name pinned)

**The job** parses `{ subredditName: string, moderatorName: string, due: number }` from the event's data, warning and returning when it's malformed. It returns when Slack isn't configured. It calls `summariseBurst` with `Date.now()`, catches and logs `[burst]` errors, and resolves.

**Integration tests**, with fake timers:

- a moderator's 20 quick removals: 5 single alerts, the fifth with the burst line; `runDueJobs("removalBurst")` after 61 s gives one summary of 20 comments, with the mod log link;
- a 12-minute burst, one removal every 10 s, gives progress at about 5 and 10 minutes with running totals, then a final summary;
- an Anti-Evil Operations sweep of 20 is combined, in the Reddit style, with no spike label and the unfiltered mod log link;
- the job run twice for the same due gives one summary;
- a lost job (cancelled in the fake scheduler) is rescued by the next removal after the overdue time;
- `runJob` rejecting at the opener means no burst line, and every removal alerts on its own;
- `registration.test.ts` lists `removalBurst`, and the Redis keys appear as pinned.

Steps:

- [ ] **Step 1:** write the tests (red).
- [ ] **Step 2:** wire, until they pass.
- [ ] **Step 3:** `dependencyBudgets.test.ts`: update the ModAction pins. Reddit's accounts' actions are now counted in the activity window; the held path is new. Say why in the commit.
- [ ] **Step 4: phase gate.** All CI steps pass. Commit "Summarise removal bursts by moderators and by Reddit's accounts".

### Task 13: the load harness for bursts

**Files:** `tests/load/realRedis.ts`, `tests/load/realRedis.load.test.ts`, `tests/load/scenarios.load.test.ts`

- [ ] **Step 1: the adapter.**
    - `watch(...keys)` returns a transaction that collects commands and runs them with node-redis's `client.multi().addCommand(args)…exec()`, mapping replies to numbers, strings or `null`. The harness's connection is shared, so raw `MULTI` would interleave.
    - `rename` sends `RENAME`.
    - The shape test checks `exec`'s results and `rename` on a real Redis.
- [ ] **Step 2: the storm scenario.**
    - Record the alerts and messages sent.
    - Add a few Alert Channel events (admin modmail) part way through, and record each one's wait from firing to posting.
- [ ] **Step 3: run them.** `npm run load:redis`, then `LOAD_SCENARIOS=storm,ramp npm run load`. Record before (c003c70's results in `load-results/`) against after.
- [ ] **Step 4:** commit "Measure the storm's messages and the alert queue's wait".

---

## Phase 3: documentation and the playtest step

### Task 14: docs

- **README:** bursts are summarised, and Alert Channel alerts go first.
- **OPERATORS-GUIDE:**
    - the two queues;
    - how bursts work, for moderators and Reddit's accounts;
    - "Data stored": the new keys, as metadata;
    - Show Bot Status's two rows;
    - troubleshooting a burst that never summarised;
    - the capacity guidance, with the new storm numbers.
- **PRIVACY-POLICY:** the burst record, kept an hour.
- **AGENTS.md:**
    - the moderation keys `mod_actions:burst*`;
    - the outbox bullet (two queues, alerts first);
    - the adapters bullet (senders tied to channel and queue).
- **docs/playtest-runbook.md:** a new step for a burst of 6 or more removals in a minute, the mod log link, and a security alert overtaking the backlog.
- [ ] Commit "Document the alert queue and removal bursts".

### Task 15: final checks and the second PR

- [ ] Every CI step passes; the coverage, typecheck, lint and format outputs are recorded.
- [ ] Check `git config user.*` and `gh api user --jq .login`, then push `alert-priority-and-bursts`. Open a PR against `observability-load-pass` with `--repo ivashkin-reddit/mod-action-notifications`.
