# Moderator workflow alerts and team statistics: roadmap

> **For the implementing agent:** this roadmap orders the work into seven phases, one pull request each. A phase's detailed plan is written, in the form of [phase 1's](2026-11-06-phase-1-quick-wins.md), when the phase before it has merged, as each builds on the code the last one leaves. REQUIRED SUB-SKILL for each phase plan: superpowers:executing-plans.

**Goal:** the alerts and team statistics in the [design](../specs/2026-11-06-moderator-workflow-alerts-design.md).

**Architecture:** each feature lives in the capability it belongs to: the moderation and modqueue modules grow, and five new capability modules arrive (`statistics`, `security`, `reports`, `modmail`, `approvedEdits`). Capabilities never import each other: the composition root fans each Devvit event out to every capability that uses it, and maps settings onto each capability's own config type.

**Tech stack:** TypeScript, Devvit Blocks (`@devvit/public-api` 0.15), Devvit Redis and scheduler, Slack's Web API through the existing outbox, Vitest.

**Spec:** [docs/superpowers/specs/2026-11-06-moderator-workflow-alerts-design.md](../specs/2026-11-06-moderator-workflow-alerts-design.md)

## Global constraints

- Done means every step of `.github/workflows/test.yml` passes locally: `npm ci`, `npm run typecheck`, `npm run coverage`, `npm run lint`, `npm run format:check`.
- Test first: each behaviour's test fails before its code exists. A unit test written after its code is checked against a deliberate break.
- Records hold metadata only; new alerts quote nothing and link without titles (design, "Rules every feature follows").
- Statistics are team-level only.
- Setting names and Redis keys are permanent once released; tests pin each new one.
- Every new trigger is listed in `devvit.json` `blocks.triggers`; `tests/integration/registration.test.ts` checks the two match.
- Files stay under 300 lines and functions under 50 (ESLint). A file about to pass that splits by responsibility first.
- No `eslint-disable` beyond `eslint-disable-next-line` with a reason and a `WORKAROUND:` block; no `as` casts in tests.
- Commits as `ivashkin-reddit <ivashkin.r@pm.me>`, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Push and open pull requests only when the owner asks.

---

## Phase 1: quick wins on existing pipelines (F1, F2, F3)

Detailed plan: [2026-11-06-phase-1-quick-wins.md](2026-11-06-phase-1-quick-wins.md).

## Phase 2: team statistics (F11)

**Why second:** it needs nothing new from Reddit, and gives the team figures early.

- **Task 2.1: split the composition root.** `src/composition.ts` is near 300 lines. Move the trigger handlers (`alertOnModAction`, `onPostDelete`, `onCommentDelete` and their helpers) to a new edge file `src/triggers.ts`; `composition.ts` keeps the shared builders (`AppContext`, `configOf`, `slackReady`, `healthReports`, `outboxOf`, ports). Add `triggers.ts` to `EDGE_FILES` in `tests/integration/architecture.test.ts` and to the composition-root row in AGENTS.md. No behaviour changes: the whole suite stays green unchanged.
- **Task 2.2: counters.** New capability `src/statistics/`.
    - `domain/counting.ts`: `actorKind(moderatorName, isAutoModerator): "moderators" | "automoderator" | "reddit"`, `dayKey(at)`, `weekKey(at)` (ISO week, Monday), `hourOf(at)`, `moderatorHash(name)` (FNV-1a 32-bit over the lower-cased name, hex), `banCounts(details)`.
    - `application/ports.ts`: `StatisticsStore` with `claimCount(actionId)`, `countAction(day, actor, type)`, `countHour(day, hour)`, `countBan(day, kind, days)`, `countUnban(day)`, `countThreadRemoval(week, postId)`, `noteActive(day, moderatorHash)`.
    - `application/countModAction.ts`: `countModAction(action: CountedAction, store)`, where `CountedAction` is the module's own type (`id`, `type`, `moderatorName`, `isAutoModerator`, `occurredAt`, `postId`, `banDays`).
    - `infrastructure/redisStatisticsStore.ts` with the keys and TTLs the design gives; `infrastructure/modActionEvent.ts` translating Devvit's event.
    - The `ModAction` trigger handler in `src/triggers.ts` calls it for every action, before Slack's setup is checked, so counts start at install.
    - Tests: `tests/integration/teamStatistics.test.ts` (each counter, an action counted once when delivered twice, no moderator name in any `stats:*` key or value); unit tests beside the domain.
- **Task 2.3: Show Team Stats.** `application/teamReport.ts` builds a `TeamReport` from the store for a range of days; `infrastructure/statsForm.ts` renders it as read-only form fields like Show Bot Status; a menu item in `main.ts`, through `forModerators`. Tests: `tests/integration/teamStatsMenu.test.ts`.
- **Task 2.4: weekly digest.** Setting `weeklyStatistics` (default off); scheduler job `weeklyStatistics`, cron `0 8 * * 1`, always scheduled by setup and reading the setting when it runs, as the daily summary does; claim `stats:digest:{week}`; `infrastructure/slackDigest.ts`. Tests: `tests/integration/weeklyDigest.test.ts` (sent once per week, nothing while off, the week before's change, top threads linked without titles).
- **Docs:** README (feature, setting, menu item, data), Operators Guide (configuration, a Statistics section, Data stored rows with kinds), privacy policy (statistics stores, hashed moderator identifiers), AGENTS.md (module row and keys).

## Phase 3: security watch (F4, F5)

- **Task 3.1: dormant moderator wakes.** New capability `src/security/`. `domain/dormancy.ts`: `wokeAfterDays(lastAt, at, dormantDays): number | undefined`. Store: `security:last_action` (hash, field = lower-cased moderator), claims `security:woke:{moderator}`; `removemoderator` deletes the removed moderator's field. Setting `dormantModeratorDays` (default 90). AutoModerator and Reddit accounts are never tracked. Alert: security style, alert channel. Tests: `tests/integration/dormantModerator.test.ts` (first action after 91 days alerts once; 89 days does not; a moderator never seen does not; removal forgets; off at 0 and with Security Alerts off).
- **Task 3.2: AutoModerator config edits.** On `wikirevise`, `infrastructure/redditWiki.ts` reads `getWikiPageRevisions({ subredditName, page: "config/automoderator", limit: 2 })` and both revisions' text with `getWikiPage(subreddit, page, { revisionId })`. `domain/configEdit.ts`: `isConfigEdit(revision, action)` (same author, within 2 minutes), `lineChanges(before, after): { added, removed }`. Alert: who, reason, `+added −removed lines`, link to `/r/{sub}/wiki/revisions/config/automoderator`. Store the edit in `security:automod_edit`. Tests: `tests/integration/automodConfigEdits.test.ts`, with the wiki in the fake Reddit (alert content; another page's edit is not alerted; a lookup failure logs a warning and sends nothing; the config's text never appears in Slack).
- **Task 3.3: misfire check.** Every AutoModerator removal or spam action increments `security:automod_hourly` (field = hour since the epoch). With an edit in `security:automod_edit` less than an hour old: `domain/misfire.ts` `isMisfire(sinceEdit, hourlyAverage)` (at least 20, and at least 5 × average). One alert per edit (claim `security:misfire:{editTime}`). Tests: `tests/integration/automodMisfire.test.ts`.
- **Docs:** as for every phase; the Security Alerts setting's help text names the new checks.

## Phase 4: reports (F6, F7)

- **Task 4.1: report triggers.** New capability `src/reports/`; `PostReport` and `CommentReport` registered in `main.ts` and listed in `devvit.json`; `infrastructure/reportEvent.ts` translates both into `Report { itemId, kind, permalink, reportCount, reason, ignoreReports }`.
- **Task 4.2: urgent reasons.** Setting `urgentReportReasons` (comma-separated). `domain/urgency.ts`: `matchedReason(reason, configured): string | undefined` (case-insensitive containment, trimmed, blanks ignored). Alert names the configured reason, never the report's text; claim `reports:urgent:{itemId}`. Tests: `tests/integration/urgentReports.test.ts` (a match alerts once; free text that matches shows only the configured reason; no match sends nothing; empty setting sends nothing).
- **Task 4.3: pile-ups.** Setting `reportPileUpThreshold`. Alert at the threshold, once per item (claim `reports:pileup:{itemId}`); skipped when the item ignores reports. Tests: `tests/integration/reportPileUps.test.ts`.
- The fake Devvit and event builders gain report events (`tests/fixtures/events.ts`).

## Phase 5: modmail (F8, F9)

- **Task 5.1: admin modmail.** New capability `src/modmail/`; `ModMail` trigger in `main.ts` and `devvit.json`. `infrastructure/redditModmail.ts` reads `reddit.modMail.getConversation({ conversationId })` and finds the message's author among `authors`. Setting `adminModmailAlerts` (default on). Alert: subject (escaped), link `https://mod.reddit.com/mail/all/{conversationId}`; claim `modmail:admin:{messageId}`. Tests: `tests/integration/adminModmail.test.ts` (an admin's message alerts once; a user's or moderator's does not; a lookup failure logs a warning).
- **Task 5.2: unanswered modmail and appeals.** Setting `modmailWaitHours`. `domain/waiting.ts`: `waitingConversations(conversations, hours, now)` (last user update after the last mod update, and old enough), counted apart for appeals. The monitor job runs it beside the modqueue checks (composition decides; the job is scheduled while either has a threshold on). Throttle `modmail:throttle:waiting` (6 hours). Tests: `tests/integration/unansweredModmail.test.ts`, `tests/integration/monitorSetup.test.ts` additions.

## Phase 6: edits after approval (F10)

- **Task 6.1: remember approvals.** New capability `src/approvedEdits/`; the `ModAction` handler hands `approvelink` and `approvecomment` to it: `approved_edits:approved:{itemId}` = `{ approver, at }`, for `editsAfterApprovalDays` days.
- **Task 6.2: alert on edits.** `PostUpdate` and `CommentUpdate` triggers; an edit by the item's author after a remembered approval alerts once a day per item (claim `approved_edits:alerted:{itemId}`): who edited, who approved, how long before, link without title. Tests: `tests/integration/editsAfterApproval.test.ts` (edit after approval alerts; edit with no approval does not; the window; neither text appears in Slack; off at 0).

## Phase 7: response times and outcomes (F12)

- **Task 7.1: entering the queue.** The reports capability's events and new `AutomoderatorFilterPost`/`AutomoderatorFilterComment` triggers hand the statistics module `queued(itemId, at, source)`: `stats:awaiting` (first time wins: `zScore` before `zAdd`; pruned past 7 days, capped at 10,000), and `stats:awaiting_rule` for AutoModerator's reason.
- **Task 7.2: leaving it.** A moderator's remove, spam or approve of an awaiting item: `zScore`, then `zRem`; only the call whose `zRem` returns 1 counts the latency bucket and outcome, so concurrent actions count once. Approvals of AutoModerator-filtered items count against the rule.
- **Task 7.3: reversals.** `stats:reddit_removed` and `stats:human_removed` (hashed remover); an approval that `zRem`s one counts a reversal.
- **Task 7.4: modmail first response.** The modmail capability hands `conversationOpened` and `moderatorReplied`; `stats:modmail_waiting` with the same `zScore`/`zRem` pattern.
- **Task 7.5: reporting them.** Digest and Show Team Stats gain medians, shares, the three AutoModerator rules with the most approvals after filtering, and reversal counts.
- **Docs:** the stores of this phase, with kinds; the privacy policy notes AutoModerator rule reasons as moderator-written configuration.
