# Playtest runbook

The automated tests run the app against fakes of Reddit, Redis and Slack. This runbook is the check against Reddit itself: a session on a test subreddit, with `npm run playtest`, that exercises each feature end to end and settles what only a live subreddit can (the "Settles" lines). Run it before a release, and after a change to a trigger, a Reddit API call or an alert.

It takes about 1 hour 30 minutes, most of it waiting for the modmail alert, which runs alongside the other steps. Tick each step as you go, and note anything unexpected with the log lines around it.

## Before you start

You need:

- **A test subreddit** you moderate, and **a test Slack workspace** with the Slack app in two channels: one for notifications, one for alerts.
- **Three Reddit accounts:**
    - **Mod A**, the account you playtest with;
    - **Mod B**, a second moderator with every permission;
    - **User**, an account that doesn't moderate the subreddit.

Then:

- [ ] Run `npm run playtest -- <test-subreddit>`, and in another terminal `npx devvit logs <test-subreddit>`. Keep the logs open throughout.
- [ ] In the app's settings for the subreddit, set:

    | Setting                         | Value                     |
    | ------------------------------- | ------------------------- |
    | Notification Channel            | the notifications channel |
    | Alert Channel                   | the alerts channel        |
    | Spam Queue Size Alert Threshold | 1                         |
    | Urgent Report Reasons           | `spam`                    |
    | Report Pile-Up Alert Threshold  | 2                         |
    | Modmail Waiting Alert (Hours)   | 1                         |

    Leave the rest at their defaults.

- [ ] As **User**, submit five text posts titled `Playtest P1` to `Playtest P5`.
- [ ] As **Mod A**, choose **Test Slack Connection** from the mod tools menu. **Expect:** the test message in the notifications channel. Then **Show Bot Status**. **Expect:** "Modqueue monitor: On, scheduled (cron …)", and no word of a missing bot token (if there is, run `npx devvit settings set slackBotToken`).

## Steps

### 1. Start the modmail clock

- [ ] **Do:** as **User**, send the subreddit two modmail messages, subjects `Playtest A` and `Playtest B`. As **Mod A**, archive `Playtest B` straight away, without replying.
- [ ] **Expect:** no alert in Slack, as User isn't a Reddit admin. No log line `[health] The app cannot read modmail`.
- **Settles:** the ModMail trigger fires, and the app finds the conversation from the event's IDs, prefixed or not.

### 2. Spam queue

- [ ] **Do:** as **Mod A**, remove P1 as spam.
- [ ] **Expect:** within 15 minutes, at the next monitor run, `⚠️ Spam Queue Alert: 1 items pending` in the alerts channel.

### 3. AutoModerator config edit

- [ ] **Do:** as **Mod A**, edit the wiki page `config/automoderator` and add the rule below. Give `playtest` as the reason for the edit.

    ```yaml
    ---
    type: comment
    body (includes): ["playtest-filter"]
    action: filter
    action_reason: "Playtest filter"
    ---
    ```

- [ ] **Expect:** `🛡️ Security alert: AutoModerator's config was edited by u/<Mod A>` in the alerts channel, with the reason `playtest`, the lines added and removed, and a History link. It never shows the config itself.
- **Settles:** a `wikirevise` action fires for `config/automoderator`, and the latest two revisions are readable when it does.

### 4. Permission change

- [ ] **Do:** as **Mod A**, take the Wiki permission from Mod B, then give it back.
- [ ] **Expect:** two `🛡️ Security Alert` messages in the alerts channel.

### 5. Urgent report, then time to act

- [ ] **Do:** as **Mod B**, report P2 as Spam. Then, as **Mod A**, remove P2 within a few minutes.
- [ ] **Expect:** `🚨 Urgent report: spam` in the alerts channel, linking to P2 without its title and giving its report count. **Show Team Stats** then counts P2:
    - "Time to act on the queue: median within 15 minutes, of N items handled";
    - "Reported items", with P2 among those removed.
- **Settles:** report events carry the report count, and the reason as Reddit words it (it must contain `spam`).

### 6. Reports piling up

- [ ] **Do:** report P3 as **Mod A** and as **Mod B**, with any reason but Spam.
- [ ] **Expect:** `📣 Reports piling up: 2 reports` in the alerts channel, once.
- **Settles:** the report count rises with each report.

### 7. Edit after approval

- [ ] **Do:** as **Mod A**, approve P4. Then, as **User**, edit P4's text.
- [ ] **Expect:** `✏️ Edited after approval: u/<User>'s post` in the alerts channel, with "Approved by: u/<Mod A>, less than an hour before the edit" and a link without the title. It never shows either version of the text.
- **Settles:** `PostUpdate` fires for an author's edit, with the post's ID and its text before the edit (`previousBody`).

### 8. AutoModerator's false positive

- [ ] **Do:** as **User**, comment `playtest-filter` on P1, so the rule from step 3 holds it in the modqueue. Then, as **Mod A**, approve it.
- [ ] **Expect:** **Show Team Stats** shows "Filtered by AutoModerator" with at least 1 approved.
- **Settles:** `AutomoderatorFilterComment` fires when AutoModerator holds a comment for review, with the comment's ID.

### 9. A removal reversed

- [ ] **Do:** as **Mod A**, remove P5. Then, as **Mod B**, approve it.
- [ ] **Expect:** **Show Team Stats** shows "Removals reversed: … 1 of another moderator's", one more than before.

### 10. Modmail waiting

- [ ] **Do:** wait until an hour has passed since step 1, then for the next monitor run, up to 15 minutes later.
- [ ] **Expect:** `📬 Modmail waiting for a reply: 1 conversation` in the alerts channel. `Playtest A` is counted. `Playtest B` isn't, as it's archived. The alert has links to the New, In Progress and Appeals folders.

### 11. Modmail reply times

- [ ] **Do:** as **Mod A**, reply to `Playtest A`.
- [ ] **Expect:** **Show Team Stats** shows "Modmail replies: median …, of N replies", counting this one.
- [ ] **Do:** as **Mod A**, reply inside the archived `Playtest B`, whose user has waited since step 1.
- [ ] **Expect:** "Modmail replies" doesn't change. The app leaves out messages in archived conversations, and B's wait ends uncounted. If the count rose, Reddit's event didn't say the conversation was archived (it may unarchive it on reply): note it.
- **Settles:** the ModMail event's `conversationState` for a message in an archived conversation.

### 12. Ban history

- [ ] **Do:** as **Mod A**, ban User for 3 days.
- [ ] **Expect:** a ban alert in the notifications channel, with "Last 30 days:" counting the removals of P2 and P5 and the spam removal of P1. If it says "nothing in mod notes", or the log has `[modaction] Could not read the user's mod notes`, the app's account can't read mod notes.
- [ ] **Do:** unban User.
- [ ] **Expect:** the unban alert names the ban it lifts: who issued it, when, and for 3 days.
- **Settles:** the app's account can read mod notes, and Devvit's `getModNotes` accepts the notes mod actions make.

### 13. Logs

- [ ] **Expect:** no `ERROR` lines in the logs for the session. A `WARN` line from the table in [OPERATORS-GUIDE.md](../OPERATORS-GUIDE.md#reading-the-logs) points to the step that failed.

## Clean up

- [ ] Delete the rule from step 3 from AutoModerator's config. That sends another security alert.
- [ ] Set back the settings from the start: Spam Queue Size Alert Threshold 0, Urgent Report Reasons blank, Report Pile-Up Alert Threshold 0, Modmail Waiting Alert (Hours) 24.
- [ ] Archive the test modmail, and delete the test posts as User.

## Not covered here

These need time, or an account, that a session doesn't have. The integration tests named cover them against fakes:

| Feature                                 | Why not live                                                     | Covered by                                     |
| --------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| Modmail from a Reddit admin             | Needs a Reddit admin to write. Confirms `isAdmin` when one does. | `adminModmail.test.ts`                         |
| A moderator acting after a long silence | Needs 90 days, or 1 day with the setting at 1                    | `dormantModerator.test.ts`                     |
| AutoModerator misfiring after an edit   | Needs 20 removals in the hour after an edit                      | `automodMisfire.test.ts`                       |
| The weekly statistics and daily summary | Post on Mondays, and each day, at 08:00 UTC: check the next one  | `weeklyDigest.test.ts`, `dailySummary.test.ts` |
| A folder of more than 100 conversations | Shows whether Reddit lists the latest first                      | `unansweredModmail.test.ts`                    |
