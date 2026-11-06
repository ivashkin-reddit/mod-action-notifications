# Phase 1: quick wins on existing pipelines, implementation plan

> **For the implementing agent:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task in the current session. Perform implementation, tests, and review yourself. Use subagents only if your human partner explicitly requests delegation. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** security alerts for changes to the mod team and its apps (F1), spam and edited queue size alerts (F2), and the user's recent mod-note history in ban alerts (F3).

**Architecture:** all three extend existing capabilities: F1 and F3 the moderation module (domain rule, ports, Slack adapter), F2 the modqueue monitor. Each adds settings through `src/settings/` and is wired in `src/composition.ts`. A first task moves the fake Reddit out of `tests/fixtures/fakeContext.ts`, which the new fakes would push past 300 lines.

**Tech stack:** TypeScript, Devvit Blocks 0.15, Vitest; Reddit's `getSpam`, `getEdited` and `getModNotes`.

**Spec:** [design](../specs/2026-11-06-moderator-workflow-alerts-design.md), features F1 to F3. **Roadmap:** [roadmap](2026-11-06-moderator-workflow-alerts-roadmap.md).

## Global constraints

- Done means every step of `.github/workflows/test.yml` passes: `npm ci`, `npm run typecheck`, `npm run coverage`, `npm run lint`, `npm run format:check`.
- New setting names, final: `securityAlerts` (boolean, default true), `spamQueueThreshold` and `editedQueueThreshold` (number, default 0), `banHistoryDays` (number, default 30). New Redis keys, final: `mod_actions:throttle:modqueue_spam`, `mod_actions:throttle:modqueue_edited`.
- Security actions, exactly: `addmoderator`, `removemoderator`, `invitemoderator`, `acceptmoderatorinvite`, `setpermissions`, `dev_platform_app_installed`, `dev_platform_app_uninstalled`, `dev_platform_app_enabled`, `dev_platform_app_disabled`, `dev_platform_app_changed`.
- Ban history shows counts by kind only, never a note's text, and reads mod notes only for a ban that is alerted.
- Run Prettier (`npx prettier --write <files>`) on every file a step changes before running lint.
- Commit as `ivashkin-reddit <ivashkin.r@pm.me>` (check `git config user.name` and `git config user.email` first), each message ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Move the fake Reddit into its own fixture

No behaviour changes; the suite stays at its current count, all green.

**Files:**

- Create: `tests/fixtures/fakeReddit.ts`
- Modify: `tests/fixtures/fakeContext.ts`, `tests/fixtures/events.ts`, `tests/fixtures/queue.ts`, `tests/integration/moderatorsOnly.test.ts`, `tests/integration/modmailNotices.test.ts`, `src/composition.ts` (a stale comment)

**Interfaces:**

- Produces: `tests/fixtures/fakeReddit.ts` exporting `QueueItem`, `ModLogEntry`, `FakePost`, `FakeUser`, `ModNotification`, `FakeReddit`, `fakeUser(username, permissions)` and `createFakeReddit(subredditName): FakeReddit`, each unchanged.

- [ ] **Step 1: Record the suite's size**

Run: `npx vitest run 2>&1 | grep -E "Tests "`
Expected: `Tests  709 passed (709)` (note the number if it differs).

- [ ] **Step 2: Create `tests/fixtures/fakeReddit.ts`**

Start it with:

```ts
import { vi } from "vitest";
import type { Mock } from "vitest";

/**
 * A stand-in for the Reddit client in Devvit's context: the members the app uses, each a vi.fn, with the state they
 * read. Listings are returned synchronously and read the state when their `all` is called, as Devvit's do.
 */
```

Then cut from `tests/fixtures/fakeContext.ts`, and paste below, each of these in its current order and wording: `QueueItem`, `ModLogEntry`, `Listing`, `FakePost`, `ListAll`, `QueueListing`, `FakeUser`, `ModNotification`, `FakeReddit`, `FakeSubreddit`, `RedditState`, `fakeUser`, `listingOf` and `createFakeReddit`. Leave `Toast` in `fakeContext.ts`. Add `export` to `function createFakeReddit`.

- [ ] **Step 3: Point `fakeContext.ts` at it**

Below the existing imports in `tests/fixtures/fakeContext.ts`, add:

```ts
import { createFakeReddit } from "./fakeReddit.js";
import type { FakeReddit } from "./fakeReddit.js";
```

and remove `Mock` from the `vitest` import only if the type checker reports it unused.

- [ ] **Step 4: Update the four importers**

- `tests/fixtures/events.ts`: `import type { FakePost } from "./fakeReddit.js";`
- `tests/fixtures/queue.ts`: `import type { QueueItem } from "./fakeReddit.js";`
- `tests/integration/moderatorsOnly.test.ts`: `import { fakeUser } from "../fixtures/fakeReddit.js";`
- `tests/integration/modmailNotices.test.ts`: import `ModNotification` from `../fixtures/fakeReddit.js`, keeping `Settings` from `../fixtures/fakeContext.js`.

- [ ] **Step 5: Fix the stale comment in `src/composition.ts`**

Replace the comment above `onPostDelete`:

```ts
/**
 * A post was deleted: its text leaves queued alerts, then a user's own deletion of a high-score post is alerted.
 * The alert about a deleted post names the post, by the owner's decision (AGENTS.md).
 */
```

with:

```ts
/**
 * A post was deleted: its text leaves queued alerts, then a user's own deletion of a high-score post is alerted, by
 * a link to it without its title or author.
 */
```

and reflow the comment above `forgetDeletedContent`, whose last line passes 120 characters, to:

```ts
/**
 * Reddit deleted a post or comment: its text leaves alerts still waiting for Slack, stays out of any queued later,
 * and is taken out of the alerts already in Slack that quote it, whether or not Slack is set up. Logs rather than
 * rejects, so a trigger goes on to its other work.
 */
```

- [ ] **Step 6: Verify nothing changed**

Run: `npm run typecheck && npx vitest run 2>&1 | grep -E "Tests " && npx eslint --max-warnings 0 tests src/composition.ts`
Expected: no type errors; the same test count as Step 1, all passed; no lint errors.

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures src/composition.ts tests/integration/moderatorsOnly.test.ts tests/integration/modmailNotices.test.ts
git commit -m "Move the fake Reddit into its own fixture" -m "fakeContext.ts would pass 300 lines with the fakes the next tasks add. The comment on onPostDelete no longer describes an alert that names the post." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Security alerts for changes to the mod team and its apps (F1)

**Files:**

- Create: `tests/integration/securityAlerts.test.ts`
- Modify: `src/moderation/domain/alerting.ts`, `src/moderation/domain/alerting.test.ts`, `src/moderation/infrastructure/actionCatalog.ts`, `src/moderation/infrastructure/slackModActionAlerts.ts`, `src/moderation/application/notifyModAction.test.ts`, `src/settings/definitions.ts`, `src/settings/config.ts`, `src/settings/config.test.ts`, `src/composition.ts`, `tests/fixtures/fakeContext.ts`, `tests/integration/registration.test.ts`, `README.md`, `OPERATORS-GUIDE.md`

**Interfaces:**

- Produces: `AlertRules.securityAlerts: boolean`; `isSecurityAction(modAction: ModAction): boolean` in `src/moderation/domain/alerting.ts`; `ModActionPresentation.securityAlerts: boolean`; `AppConfig.securityAlerts: boolean`.

- [ ] **Step 1: Write the failing integration test**

Create `tests/integration/securityAlerts.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { modActionEvent } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { lines, onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const ALERT_CHANNEL = "C0ALERTS";

/** ModA takes the action on ModB. */
function teamChange(action: string): ReturnType<typeof modActionEvent> {
    return modActionEvent({ action, moderator: { name: "ModA" }, targetUser: { name: "ModB" } });
}

// Changing who moderates, or which apps act here, is what a compromised moderator account would do first.
describe("a change to the mod team or its apps", (): void => {
    it.each([
        ["setpermissions", "🔑 Moderator Permissions Changed"],
        ["addmoderator", "👤 Moderator Added"],
        ["removemoderator", "👤 Moderator Removed"],
        ["dev_platform_app_installed", "🧩 App Installed"],
    ])(
        "is sent as a security alert to the alert channel: %s",
        TEST_OPTIONS,
        async (action: string, title: string): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, { alertChannel: ALERT_CHANNEL });

            await app.fire("ModAction", teamChange(action));

            const message = onlyMessage(app.slack.messages);

            expect([message.channel, message.text, lines(message)[0]]).toStrictEqual([
                ALERT_CHANNEL,
                `🛡️ Security alert: ${title}`,
                "🛡️ *Security Alert*",
            ]);
        },
    );

    it("is sent whatever Enabled Mod Actions and Excluded Moderators say", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { enabledActions: ["removelink"], excludedModerators: "ModA" });

        await app.fire("ModAction", teamChange("setpermissions"));

        expect(app.slack.messages).toHaveLength(1);
    });

    it("follows Enabled Mod Actions while Security Alerts is off", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { securityAlerts: false, enabledActions: ["addmoderator"] });

        await app.fire("ModAction", teamChange("setpermissions"));
        await app.fire("ModAction", teamChange("addmoderator"));

        expect(app.slack.messages.map(({ text }): string => text)).toStrictEqual(["👤 Moderator Added"]);
    });
});
```

Add `securityAlerts?: unknown;` to the `Settings` interface in `tests/fixtures/fakeContext.ts`, after `flagUnknownModerators`.

- [ ] **Step 2: Add the failing unit tests**

In `src/moderation/domain/alerting.test.ts`, add `securityAlerts: false,` to `RULES`, and append:

```ts
describe("a security action", (): void => {
    it("is reported while security alerts are on, whatever else the rules say", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const rules = { ...RULES, enabledActions: [], excludedModerators: ["moda"], securityAlerts: true };

        expect(isReported(modAction({ type: "setpermissions" }), rules)).toBe(true);
    });

    it("follows the other rules while security alerts are off", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(isReported(modAction({ type: "setpermissions" }), { ...RULES, securityAlerts: false })).toBe(false);
    });
});
```

In `tests/integration/registration.test.ts`, after `{ name: "flagUnknownModerators", type: "boolean", defaultValue: true },` add:

```ts
                { name: "securityAlerts", type: "boolean", defaultValue: true },
```

In `src/settings/config.test.ts`, add `securityAlerts: true,` after `flagUnknownModerators: true,` in the defaults.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/integration/securityAlerts.test.ts src/moderation/domain/alerting.test.ts tests/integration/registration.test.ts src/settings/config.test.ts 2>&1 | grep -E "×|Tests "`
Expected: the four `it.each` cases and "is sent whatever Enabled Mod Actions and Excluded Moderators say" fail, as do the unit case "is reported while security alerts are on…", the registration list and the config defaults. "follows Enabled Mod Actions while Security Alerts is off" and the unit case "follows the other rules…" pass already: they pin what must stay true.

- [ ] **Step 4: The domain rule**

Replace `src/moderation/domain/alerting.ts` with:

```ts
import { actionTypeOf } from "./modAction.js";
import type { ModAction } from "./modAction.js";

/** Which mod actions moderators are told about. */
export interface AlertRules {
    /** Reddit's action types to report, such as removelink. */
    readonly enabledActions: readonly string[];
    /** Lower-cased usernames whose actions are not reported. */
    readonly excludedModerators: readonly string[];
    readonly enableAutoModAlerts: boolean;
    /** Report every security action, as a security alert, whatever the other rules say. */
    readonly securityAlerts: boolean;
}

/**
 * Actions that change who moderates the subreddit and with which permissions, or which apps act in it: what a
 * compromised moderator account would do first.
 */
const SECURITY_ACTIONS: ReadonlySet<string> = new Set([
    "addmoderator",
    "removemoderator",
    "invitemoderator",
    "acceptmoderatorinvite",
    "setpermissions",
    "dev_platform_app_installed",
    "dev_platform_app_uninstalled",
    "dev_platform_app_enabled",
    "dev_platform_app_disabled",
    "dev_platform_app_changed",
]);

export function isSecurityAction(modAction: ModAction): boolean {
    return SECURITY_ACTIONS.has(actionTypeOf(modAction));
}

/**
 * Whether moderators are told about the action: a security action while security alerts are on; otherwise one of
 * an enabled type, by a moderator not excluded, and not AutoModerator's while AutoModerator alerts are off.
 */
export function isReported(modAction: ModAction, rules: AlertRules): boolean {
    if (rules.securityAlerts && isSecurityAction(modAction)) {
        return true;
    }
    const moderatorName = (modAction.moderatorName ?? "").toLowerCase();
    return (
        rules.enabledActions.includes(actionTypeOf(modAction)) &&
        !rules.excludedModerators.includes(moderatorName) &&
        (rules.enableAutoModAlerts || !modAction.isAutoModerator)
    );
}
```

In `src/moderation/application/notifyModAction.test.ts`, add `securityAlerts: false,` to `CONFIG`.

- [ ] **Step 5: The catalog entries**

In `src/moderation/infrastructure/actionCatalog.ts`, after the `disable_post_crowd_control_filter` entry of `ACTION_STYLES`, add:

```ts
    [
        "setpermissions",
        { label: "Change Moderator Permissions", emoji: "🔑", name: "Moderator Permissions Changed", color: "#ff8800" },
    ],
    ["wikirevise", { label: "Edit Wiki Page", emoji: "📝", name: "Wiki Page Edited", color: "#8800ff" }],
    ["createrule", { label: "Create Rule", emoji: "📜", name: "Rule Created", color: "#0088ff" }],
    ["editrule", { label: "Edit Rule", emoji: "📜", name: "Rule Edited", color: "#8800ff" }],
    ["deleterule", { label: "Delete Rule", emoji: "📜", name: "Rule Deleted", color: "#ff4444" }],
    ["reorderrules", { label: "Reorder Rules", emoji: "📜", name: "Rules Reordered", color: "#888888" }],
    [
        "edit_post_requirements",
        { label: "Edit Post Requirements", emoji: "📋", name: "Post Requirements Edited", color: "#8800ff" },
    ],
    ["dev_platform_app_installed", { label: "Install App", emoji: "🧩", name: "App Installed", color: "#0088ff" }],
    ["dev_platform_app_uninstalled", { label: "Uninstall App", emoji: "🧩", name: "App Uninstalled", color: "#ff4444" }],
    ["dev_platform_app_enabled", { label: "Enable App", emoji: "🧩", name: "App Enabled", color: "#00cc00" }],
    ["dev_platform_app_disabled", { label: "Disable App", emoji: "🧩", name: "App Disabled", color: "#ff8800" }],
    ["dev_platform_app_changed", { label: "Change App", emoji: "🧩", name: "App Changed", color: "#8800ff" }],
```

- [ ] **Step 6: The security alert's style and channel**

In `src/moderation/infrastructure/slackModActionAlerts.ts`:

1. Add `import { isSecurityAction } from "../domain/alerting.js";` to the imports, and to `ModActionPresentation`:

```ts
    /** Send security actions as security alerts, to the alert channel. */
    readonly securityAlerts: boolean;
```

2. After `ACTOR_STYLES`, add:

```ts
/** A security action's alert, unless an unknown moderator took it: theirs is a security alert already. */
const SECURITY_STYLE: ActorStyle = {
    header: "🛡️ *Security Alert*",
    text: (title: string): string => `🛡️ Security alert: ${title}`,
    icon: ":shield:",
    status: "",
};

/** A security action while Security Alerts is on, unless an unknown moderator took it: that alert is one already. */
function isSecurityAlert(modAction: ModAction, actor: Actor, presentation: ModActionPresentation): boolean {
    return presentation.securityAlerts && actor !== "unknown-moderator" && isSecurityAction(modAction);
}

function styleOf(modAction: ModAction, actor: Actor, presentation: ModActionPresentation): ActorStyle {
    return isSecurityAlert(modAction, actor, presentation) ? SECURITY_STYLE : ACTOR_STYLES[actor];
}
```

3. In `messageLines`, replace `ACTOR_STYLES[actor].header,` with `styleOf(modAction, actor, presentation).header,`.
4. In `modActionMessage`, replace `const style = ACTOR_STYLES[actor];` with `const style = styleOf(modAction, actor, presentation);`, and its last line with:

```ts
const toAlertChannel = unknownModerator || isSecurityAlert(modAction, actor, presentation);
return inChannel(message, toAlertChannel ? presentation.alertChannel : presentation.notificationChannel);
```

`statusLines` keeps `ACTOR_STYLES[actor].status`, so a security action Reddit took still says "Origin Reddit".

- [ ] **Step 7: The setting**

In `src/settings/definitions.ts`, after the `flagUnknownModerators` entry of `OTHER_SETTINGS`, add:

```ts
    {
        type: "boolean",
        name: "securityAlerts",
        label: "Security Alerts",
        helpText:
            "Always send changes to the mod team (moderators added, removed or invited, permissions changed) and to Devvit apps (installed, removed, enabled, disabled or changed) as security alerts to the alert channel, whatever Enabled Mod Actions and Excluded Moderators say",
        defaultValue: true,
    },
```

In `src/settings/config.ts`: add to `AppConfig`, after `flagUnknownModerators`,

```ts
    /** Send every security action as a security alert. */
    readonly securityAlerts: boolean;
```

add `securityAlerts: true,` to `DEFAULT_CONFIG` after `flagUnknownModerators: true,`, and to `readConfig`'s result after `flagUnknownModerators`:

```ts
        securityAlerts: booleanOr(await settings.get("securityAlerts"), true),
```

In `src/composition.ts`, add `securityAlerts: config.securityAlerts,` to both `moderationConfig`'s and `modActionPresentation`'s results.

- [ ] **Step 8: Run the tests**

Run: `npm run typecheck && npx vitest run 2>&1 | grep -E "×|Tests "`
Expected: all pass. If a test that counts the catalog's action types fails, update its expected count to 43 (31 + 12).

- [ ] **Step 9: Docs**

- `README.md`: replace the **Security alerts.** paragraph's first sentence with: "Changes to your mod team (moderators added, removed or invited, and changes to their permissions) and to the Devvit apps installed in your subreddit always come as security alerts, to a separate channel if you like. So does an action by an account that isn't on your mod list." Add a settings row after Flag Unknown Moderators: `| Security Alerts | Always send changes to the mod team and its Devvit apps as security alerts, whatever Enabled Mod Actions and Excluded Moderators say. | on |`.
- `OPERATORS-GUIDE.md`: in the configuration table, change "any of 31 action types" to "any of 43 action types", and add a row after Flag Unknown Moderators: `| Security Alerts (\`securityAlerts\`) | on or off | Sends the security actions (\`addmoderator\`, \`removemoderator\`, \`invitemoderator\`, \`acceptmoderatorinvite\`, \`setpermissions\`, \`dev_platform_app_*\`) as security alerts to the alert channel, whatever Enabled Mod Actions and Excluded Moderators say. |`. In "Mod action alerts", step **Should it alert?**, prepend: "A security action always alerts while Security Alerts is on. Otherwise, only if…".

- [ ] **Step 10: Format, lint, commit**

Run: `npx prettier --write src tests README.md OPERATORS-GUIDE.md && npm run lint && npm run format:check`
Expected: no errors.

```bash
git add src tests README.md OPERATORS-GUIDE.md
git commit -m "Send changes to the mod team and its apps as security alerts" -m "Twelve more action types join the catalog (permissions, wiki, rules, post requirements, Devvit apps). The security actions among them, and moderator additions, removals and invites, now always alert, to the alert channel, while the new Security Alerts setting is on (default), whatever Enabled Mod Actions and Excluded Moderators say." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Spam and edited queue size alerts (F2)

**Files:**

- Create: `tests/integration/spamAndEditedQueues.test.ts`
- Modify: `src/modqueue/domain/monitoring.ts`, `src/modqueue/domain/monitoring.test.ts`, `src/modqueue/application/ports.ts`, `src/modqueue/application/checkModqueue.ts`, `src/modqueue/infrastructure/redditModqueue.ts`, `src/modqueue/infrastructure/redisMonitorStore.ts`, `src/modqueue/infrastructure/slackAlerts.ts`, `src/settings/definitions.ts`, `src/settings/config.ts`, `src/settings/config.test.ts`, `src/composition.ts`, `tests/fixtures/fakeReddit.ts`, `tests/fixtures/fakeContext.ts`, `tests/integration/registration.test.ts`, `tests/integration/settingsValidation.test.ts`, `README.md`, `OPERATORS-GUIDE.md`

**Interfaces:**

- Consumes: `createFakeReddit` from Task 1.
- Produces: `MonitorThresholds.spamQueueThreshold`, `MonitorThresholds.editedQueueThreshold`; `ModerationQueues.spam()`, `ModerationQueues.edited()`; `WatchedQueue = "modqueue" | "spam" | "edited"`; `QueueTooLongAlert.queue: WatchedQueue`; `QueueAlert` gains `"spam-size" | "edited-size"`.

- [ ] **Step 1: The fake queues**

In `tests/fixtures/fakeReddit.ts`:

- `FakeReddit` gains, after `reports`:

```ts
    /** Reddit's spam queue, and its edited queue. */
    spam: readonly QueueItem[];
    edited: readonly QueueItem[];
```

and, after `reportsAll` and `getReports` respectively:

```ts
    readonly spamAll: ListAll<QueueItem>;
    readonly editedAll: ListAll<QueueItem>;
```

```ts
    readonly getSpam: QueueListing;
    readonly getEdited: QueueListing;
```

- `FakeSubreddit` picks `"getSpam" | "getEdited"` too; `RedditState` picks `"spam" | "edited"` too.
- In `createFakeReddit`: add `spam: [], edited: [],` to the state; after `const reports = …` add

```ts
const spam = listingOf((): readonly QueueItem[] => reddit.spam);
const edited = listingOf((): readonly QueueItem[] => reddit.edited);
```

add `getSpam: spam.open, getEdited: edited.open,` to `subreddit`, and `spamAll: spam.all, editedAll: edited.all,` beside `reportsAll`.

In `tests/fixtures/fakeContext.ts`, add `spamQueueThreshold?: unknown;` and `editedQueueThreshold?: unknown;` to `Settings`, after `reportedContentAgeHours`.

- [ ] **Step 2: Write the failing integration test**

Create `tests/integration/spamAndEditedQueues.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { loadApp } from "../fixtures/app.js";
import { CHANNEL } from "../fixtures/fakeContext.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import { monitorJobs } from "../fixtures/jobs.js";
import { NOW_SECONDS } from "../fixtures/messages.js";
import { queuedComment, queuedPost } from "../fixtures/queue.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
/** Every other monitor alert off, so a run alerts about these queues alone. */
const ONLY_THESE = { modqueueThreshold: 0, unmoderagedAgeHours: 0, reportedContentAgeHours: 0 };

/** The queue-size alert's fields for a queue of one post and one comment, at a threshold of 2. */
const FIELDS = [
    { title: "📋 Queue Size", value: "2", short: true },
    { title: "📝 Posts", value: "1", short: true },
    { title: "💬 Comments", value: "1", short: true },
    { title: "🎯 Threshold", value: "2", short: true },
];

function sizeAlert(text: string): unknown {
    return {
        text,
        username: "Mod Action Notifications",
        icon_emoji: ":warning:",
        channel: CHANNEL,
        attachments: [
            {
                color: "#ff9900",
                fields: FIELDS,
                footer: "Mod Action Notifications - Modqueue Monitor",
                ts: NOW_SECONDS,
            },
        ],
    };
}

describe("the spam queue", (): void => {
    it("alerts when it holds at least its threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...ONLY_THESE, spamQueueThreshold: 2 });
        app.context.reddit.spam = [queuedPost("a", 1), queuedComment("b", 1)];

        await app.runJob("modqueueMonitor");

        expect(app.context.reddit.getSpam).toHaveBeenCalledWith({ type: "all" });
        expect(app.slack.messages).toStrictEqual([sizeAlert("⚠️ Spam Queue Alert: 2 items pending")]);
    });

    it("alerts at most once an hour", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...ONLY_THESE, spamQueueThreshold: 2 });
        app.context.reddit.spam = [queuedPost("a", 1), queuedComment("b", 1)];

        await app.runJob("modqueueMonitor");
        await app.runJob("modqueueMonitor");

        expect(app.slack.messages).toHaveLength(1);
        expect(app.context.redis.ttlSeconds("mod_actions:throttle:modqueue_spam")).toBe(3600);
    });
});

describe("the edited queue", (): void => {
    it("alerts when it holds at least its threshold", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...ONLY_THESE, editedQueueThreshold: 2 });
        app.context.reddit.edited = [queuedPost("a", 1), queuedComment("b", 1)];

        await app.runJob("modqueueMonitor");

        expect(app.context.reddit.getEdited).toHaveBeenCalledWith({ type: "all" });
        expect(app.slack.messages).toStrictEqual([sizeAlert("⚠️ Edited Queue Alert: 2 items pending")]);
        expect(app.context.redis.ttlSeconds("mod_actions:throttle:modqueue_edited")).toBe(3600);
    });
});

describe("the spam and edited queue thresholds", (): void => {
    it("leave both queues unread at 0", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, ONLY_THESE);

        await app.runJob("modqueueMonitor");

        expect(app.context.reddit.getSpam).not.toHaveBeenCalled();
        expect(app.context.reddit.getEdited).not.toHaveBeenCalled();
    });

    it("keep the monitor scheduled when they are the only alert on", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { ...ONLY_THESE, editedQueueThreshold: 5 });

        await app.fire("AppInstall", { type: "AppInstall" });

        expect(monitorJobs(app.context.scheduler.jobs)).toHaveLength(1);
    });
});
```

- [ ] **Step 3: Pin the settings**

- `tests/integration/registration.test.ts`: after `{ name: "reportedContentAgeHours", type: "number", defaultValue: 24 },` add `{ name: "spamQueueThreshold", type: "number", defaultValue: 0 },` and `{ name: "editedQueueThreshold", type: "number", defaultValue: 0 },`.
- `tests/integration/settingsValidation.test.ts`: add `["spamQueueThreshold"], ["editedQueueThreshold"],` to `THRESHOLDS`.
- `src/settings/config.test.ts`: add `spamQueueThreshold: 0, editedQueueThreshold: 0,` to the defaults, after `reportedContentAgeHours: 24,`.
- `src/modqueue/domain/monitoring.test.ts`: change `OFF` to `{ queueSizeThreshold: 0, unmoderatedAgeHours: 0, reportedAgeHours: 0, spamQueueThreshold: 0, editedQueueThreshold: 0 }`, and add to the `isMonitoringEnabled` table:

```ts
        ["the spam queue alert is on", { ...OFF, spamQueueThreshold: 10 }, true],
        ["the edited queue alert is on", { ...OFF, editedQueueThreshold: 10 }, true],
```

- [ ] **Step 4: Run them to see them fail**

Run: `npx vitest run tests/integration/spamAndEditedQueues.test.ts tests/integration/registration.test.ts tests/integration/settingsValidation.test.ts src/settings/config.test.ts src/modqueue 2>&1 | grep -E "×|Tests "`
Expected: the new cases fail (alerts missing, settings unknown); `typecheck` also fails on `OFF`.

- [ ] **Step 5: Domain and ports**

In `src/modqueue/domain/monitoring.ts`, add to `MonitorThresholds`:

```ts
    /** Alert when Reddit's spam queue holds at least this many items; 0 turns the alert off. */
    readonly spamQueueThreshold: number;
    /** Alert when Reddit's edited queue holds at least this many items; 0 turns the alert off. */
    readonly editedQueueThreshold: number;
```

and replace `isMonitoringEnabled`'s body with:

```ts
return [
    thresholds.queueSizeThreshold,
    thresholds.unmoderatedAgeHours,
    thresholds.reportedAgeHours,
    thresholds.spamQueueThreshold,
    thresholds.editedQueueThreshold,
].some((threshold: number): boolean => isAlertOn(threshold));
```

In `src/modqueue/application/ports.ts`: add to `ModerationQueues`

```ts
    /** Reddit's spam queue: content its spam filter, or a moderator, marked as spam. */
    readonly spam: () => Promise<readonly QueueItem[]>;
    /** Reddit's edited queue: posts and comments edited lately. */
    readonly edited: () => Promise<readonly QueueItem[]>;
```

replace `QueueAlert` with

```ts
/** The kinds of queue alert, each throttled on its own. */
export type QueueAlert = "queue-size" | "spam-size" | "edited-size" | "unmoderated" | "reported";

/** A queue whose size the monitor watches. */
export type WatchedQueue = "modqueue" | "spam" | "edited";
```

and add as the first member of `QueueTooLongAlert`:

```ts
    /** Which queue is too long. */
    readonly queue: WatchedQueue;
```

- [ ] **Step 6: The checks**

In `src/modqueue/application/checkModqueue.ts`, import `WatchedQueue` with the other port types, and replace `alertIfQueueTooLong` with:

```ts
/** A queue whose size has a threshold: the listing it reads, and the alert it claims. */
type SizeCheck = Readonly<{
    queue: WatchedQueue;
    alert: "queue-size" | "spam-size" | "edited-size";
    read: () => Promise<readonly QueueItem[]>;
    threshold: number;
}>;

function sizeChecks(queues: ModerationQueues, thresholds: MonitorThresholds): readonly SizeCheck[] {
    return [
        { queue: "modqueue", alert: "queue-size", read: queues.modqueue, threshold: thresholds.queueSizeThreshold },
        { queue: "spam", alert: "spam-size", read: queues.spam, threshold: thresholds.spamQueueThreshold },
        { queue: "edited", alert: "edited-size", read: queues.edited, threshold: thresholds.editedQueueThreshold },
    ];
}

/** Reads the queue while its alert is on, and alerts when it is too long: at most once an hour for each queue. */
async function alertIfQueueTooLong(
    { queue, alert, read, threshold }: SizeCheck,
    ports: CheckModqueuePorts,
): Promise<void> {
    if (!isAlertOn(threshold)) {
        return;
    }
    const items = await read();
    if (isQueueTooLong(items.length, threshold) && (await ports.store.claimAlert(alert, ALERT_PERIOD_SECONDS))) {
        await ports.alerts.queueTooLong({ queue, size: items.length, ...countByKind(items), threshold });
    }
}
```

and in `checkQueues` replace the first `if` block with:

```ts
await Promise.all(
    sizeChecks(queues, thresholds).map(async (check: SizeCheck): Promise<void> => {
        await alertIfQueueTooLong(check, ports);
    }),
);
```

Update the doc comment on `checkModqueue` to begin: "One run of the modqueue monitor: alerts when the modqueue, the spam queue or the edited queue is too long, …".

- [ ] **Step 7: Adapters**

- `src/modqueue/infrastructure/redditModqueue.ts`, in `openRedditQueues`'s result:

```ts
        spam: async (): Promise<readonly QueueItem[]> =>
            (await subreddit.getSpam({ type: "all" }).all()).map(queueItemOf),
        edited: async (): Promise<readonly QueueItem[]> =>
            (await subreddit.getEdited({ type: "all" }).all()).map(queueItemOf),
```

- `src/modqueue/infrastructure/redisMonitorStore.ts`, in `THROTTLE_KEYS`:

```ts
    "spam-size": "mod_actions:throttle:modqueue_spam",
    "edited-size": "mod_actions:throttle:modqueue_edited",
```

- `src/modqueue/infrastructure/slackAlerts.ts`: import `WatchedQueue` with the port types; before `queueTooLongMessage` add

```ts
/** How each watched queue's size alert is titled. */
const QUEUE_TITLES: Readonly<Record<WatchedQueue, string>> = {
    modqueue: "Modqueue Alert",
    spam: "Spam Queue Alert",
    edited: "Edited Queue Alert",
};
```

and change its signature and text to:

```ts
function queueTooLongMessage({ queue, size, posts, comments, threshold }: QueueTooLongAlert): SlackMessage {
    return {
        text: `⚠️ ${QUEUE_TITLES[queue]}: ${String(size)} items pending`,
```

- [ ] **Step 8: Settings and wiring**

- `src/settings/definitions.ts`: export `DEFAULT_SPAM_QUEUE_THRESHOLD = 0` and `DEFAULT_EDITED_QUEUE_THRESHOLD = 0` beside the other defaults; after the `reportedContentAgeHours` entry add

```ts
    {
        type: "number",
        name: "spamQueueThreshold",
        label: "Spam Queue Size Alert Threshold",
        helpText: "Alert when Reddit's spam queue holds at least this many items (0 to disable)",
        defaultValue: DEFAULT_SPAM_QUEUE_THRESHOLD,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
    {
        type: "number",
        name: "editedQueueThreshold",
        label: "Edited Queue Size Alert Threshold",
        helpText:
            "Alert when Reddit's edited queue, of recently edited posts and comments, holds at least this many items (0 to disable)",
        defaultValue: DEFAULT_EDITED_QUEUE_THRESHOLD,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            wholeNumberProblem(value),
    },
```

- `src/settings/config.ts`: import both defaults; add to `AppConfig` after `reportedContentAgeHours`

```ts
    /** 0 turns the spam queue alert off. */
    readonly spamQueueThreshold: number;
    /** 0 turns the edited queue alert off. */
    readonly editedQueueThreshold: number;
```

add both to `DEFAULT_CONFIG` (their defaults), and to `readConfig`'s result:

```ts
        spamQueueThreshold: nonNegativeInteger(await settings.get("spamQueueThreshold"), DEFAULT_SPAM_QUEUE_THRESHOLD),
        editedQueueThreshold: nonNegativeInteger(
            await settings.get("editedQueueThreshold"),
            DEFAULT_EDITED_QUEUE_THRESHOLD,
        ),
```

- `src/composition.ts`, in `monitorThresholds`:

```ts
        spamQueueThreshold: config.spamQueueThreshold,
        editedQueueThreshold: config.editedQueueThreshold,
```

- [ ] **Step 9: Run the tests**

Run: `npm run typecheck && npx vitest run 2>&1 | grep -E "×|Tests "`
Expected: all pass.

- [ ] **Step 10: Docs**

- `README.md`: in the modqueue feature paragraph add "It can also watch Reddit's spam queue and edited queue." Add settings rows after Old Reported Content Alert: `| Spam Queue Size Alert Threshold | Alert when the spam queue holds at least this many items. | 0 (off) |` and `| Edited Queue Size Alert Threshold | Alert when the edited queue, of recently edited posts and comments, holds at least this many items. | 0 (off) |`.
- `OPERATORS-GUIDE.md`: two configuration rows (stored names, "a whole number of 0 or more", effect); in "Modqueue monitor", the spam and edited queue checks; in "Data stored", the two throttle keys (kind none, 1 hour, 1 key each), or widen the existing throttle row to `modqueue_{size\|spam\|edited\|unmoderated\|reported}` with limit 5 keys.

- [ ] **Step 11: Format, lint, commit**

Run: `npx prettier --write src tests README.md OPERATORS-GUIDE.md && npm run lint && npm run format:check`

```bash
git add src tests README.md OPERATORS-GUIDE.md
git commit -m "Alert when the spam or edited queue grows too long" -m "The modqueue monitor also reads Reddit's spam and edited queues while their new thresholds (spamQueueThreshold, editedQueueThreshold, off by default) are on, and alerts at most once an hour for each, as for the modqueue." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The user's recent mod-note history in ban alerts (F3)

**Files:**

- Create: `src/moderation/domain/history.ts`, `src/moderation/domain/history.test.ts`, `tests/integration/banHistory.test.ts`
- Modify: `src/moderation/domain/modAction.ts`, `src/moderation/application/ports.ts`, `src/moderation/application/notifyModAction.ts`, `src/moderation/application/notifyModAction.test.ts`, `src/moderation/application/simulateModAction.ts`, `src/moderation/infrastructure/modActionEvent.ts`, `src/moderation/infrastructure/redditModeration.ts`, `src/moderation/infrastructure/slackModActionAlerts.ts`, `src/settings/definitions.ts`, `src/settings/config.ts`, `src/settings/config.test.ts`, `src/composition.ts`, `tests/fixtures/fakeReddit.ts`, `tests/fixtures/fakeContext.ts`, `tests/fixtures/modActions.ts`, `tests/fixtures/moderationPorts.ts`, `tests/integration/registration.test.ts`, `tests/integration/bans.test.ts`, `tests/integration/banModNotes.test.ts`, `README.md`, `OPERATORS-GUIDE.md`, `PRIVACY-POLICY.md`

**Interfaces:**

- Produces: `NoteKind`, `NoteEntry`, `HistoryCounts`, `RecentHistory` and `recentHistory(notes, at, days)` in `src/moderation/domain/history.ts`; `ModAction.recentHistory: RecentHistory | undefined`; `ModerationLookups.modNotes(subredditName: string | undefined, username: string): Promise<readonly NoteEntry[]>`; `ModerationConfig.banHistoryDays: number`; `AppConfig.banHistoryDays: number`.

- [ ] **Step 1: Write the failing domain test**

Create `src/moderation/domain/history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import { recentHistory } from "./history.js";
import type { NoteEntry, NoteKind } from "./history.js";

const TEST_OPTIONS = { timeout: 1000 };
const DAY = 86_400_000;

function note(kind: NoteKind, daysBefore: number): NoteEntry {
    return { kind, createdAt: new Date(NOW.getTime() - daysBefore * DAY) };
}

describe("a user's recent history", (): void => {
    it("counts their notes in the days before the action, by kind", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const notes = [note("removal", 2), note("removal", 5), note("ban", 10), note("note", 29)];

        expect(recentHistory(notes, NOW, 30)).toStrictEqual({
            days: 30,
            counts: { removal: 2, spam: 0, ban: 1, mute: 0, note: 1 },
        });
    });

    // Reddit notes a ban as it is made, to the second: that note is the action's own.
    it("leaves out notes older than the window, and the action's own", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const notes: readonly NoteEntry[] = [
            note("removal", 31),
            note("ban", 0),
            { kind: "ban", createdAt: new Date(NOW.getTime() + 400) },
        ];

        expect(recentHistory(notes, NOW, 30).counts).toStrictEqual({ removal: 0, spam: 0, ban: 0, mute: 0, note: 0 });
    });

    it("leaves out kinds it does not count", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(recentHistory([note("other", 1)], NOW, 30).counts).toStrictEqual({
            removal: 0,
            spam: 0,
            ban: 0,
            mute: 0,
            note: 0,
        });
    });
});
```

Run: `npx vitest run src/moderation/domain/history.test.ts`
Expected: FAIL, cannot find module `./history.js`.

- [ ] **Step 2: The domain**

Create `src/moderation/domain/history.ts`:

```ts
/** What an entry in Reddit's mod notes about a user records; "other" for kinds a ban alert does not count. */
export type NoteKind = "removal" | "spam" | "ban" | "mute" | "note" | "other";

/** An entry in a user's mod notes: its kind and when it was made. Never its text. */
export interface NoteEntry {
    readonly kind: NoteKind;
    readonly createdAt: Date;
}

/** How many of each counted kind of note a user had. */
export type HistoryCounts = Readonly<Record<Exclude<NoteKind, "other">, number>>;

/** What a user's mod notes record in the `days` before an action. */
export interface RecentHistory {
    readonly days: number;
    readonly counts: HistoryCounts;
}

const MS_PER_DAY = 86_400_000;
const MS_PER_SECOND = 1000;
const NONE: HistoryCounts = { removal: 0, spam: 0, ban: 0, mute: 0, note: 0 };

/**
 * Counts, by kind, the user's notes from the `days` before `at`. Reddit notes an action as it is made, to the
 * second, so notes from the second of `at` on are the action's own, and are left out.
 */
export function recentHistory(notes: readonly NoteEntry[], at: Date, days: number): RecentHistory {
    const end = Math.floor(at.getTime() / MS_PER_SECOND) * MS_PER_SECOND;
    const start = end - days * MS_PER_DAY;
    const counts = notes.reduce((total: HistoryCounts, { kind, createdAt }: NoteEntry): HistoryCounts => {
        const time = createdAt.getTime();
        return kind === "other" || time < start || time >= end ? total : { ...total, [kind]: total[kind] + 1 };
    }, NONE);
    return { days, counts };
}
```

Run: `npx vitest run src/moderation/domain/history.test.ts`
Expected: 3 passed.

- [ ] **Step 3: The fake mod notes**

In `tests/fixtures/fakeReddit.ts`, add:

```ts
/** An entry in a user's mod notes, as `reddit.getModNotes(...).all()` returns it: what the app reads. */
export interface FakeModNote {
    readonly user: string;
    readonly type: string;
    readonly createdAt: Date;
}
```

`FakeReddit` gains `modNotes: readonly FakeModNote[];` (state) and

```ts
    readonly getModNotes: Mock<
        (options: Readonly<{ subreddit: string; user: string; limit: number }>) => Listing<FakeModNote>
    >;
```

`RedditState` picks `"modNotes"`. In `createFakeReddit` add `modNotes: [],` to the state and

```ts
        getModNotes: vi.fn(
            (options: Readonly<{ subreddit: string; user: string; limit: number }>): Listing<FakeModNote> => ({
                all: async (): Promise<readonly FakeModNote[]> =>
                    await Promise.resolve(
                        reddit.modNotes.filter(
                            (note: FakeModNote): boolean => note.user.toLowerCase() === options.user.toLowerCase(),
                        ),
                    ),
            }),
        ),
```

beside `getModerationLog`. Export `Listing` (add `export` to its declaration) for the failure test below.

In `tests/fixtures/fakeContext.ts`, add `banHistoryDays?: unknown;` to `Settings`, after `includeModNote`.

- [ ] **Step 4: Write the failing integration test**

Create `tests/integration/banHistory.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { loadApp, NOW } from "../fixtures/app.js";
import { bannedUser, removedPost } from "../fixtures/events.js";
import type { FakeDevvit } from "../fixtures/fakeDevvit.js";
import type { FakeModNote, Listing } from "../fixtures/fakeReddit.js";
import type { Settings } from "../fixtures/fakeContext.js";
import { lines, onlyMessage } from "../fixtures/messages.js";

const devvit = await vi.hoisted(async (): Promise<FakeDevvit> =>
    (await import("../fixtures/fakeDevvit.js")).createFakeDevvit(),
);
vi.mock("@devvit/public-api", (): { Devvit: FakeDevvit["api"] } => ({ Devvit: devvit.api }));

const TEST_OPTIONS = { timeout: 5000 };
const DAY = 86_400_000;

/** A note on Troll, made `daysBefore` days before NOW. */
function trollNote(type: string, daysBefore: number): FakeModNote {
    return { user: "Troll", type, createdAt: new Date(NOW.getTime() - daysBefore * DAY) };
}

function historyLine(lineList: readonly string[]): string | undefined {
    return lineList.find((line: string): boolean => line.startsWith("• *Last "));
}

describe("a ban alert", (): void => {
    it(
        "counts the user's mod notes from the 30 days before the ban, by kind, never their text",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit);
            app.context.reddit.modNotes = [
                trollNote("REMOVAL", 2),
                trollNote("REMOVAL", 6),
                trollNote("BAN", 10),
                trollNote("APPROVAL", 1),
                trollNote("NOTE", 40),
                trollNote("BAN", 0),
            ];

            await app.fire("ModAction", bannedUser());

            expect(app.context.reddit.getModNotes).toHaveBeenCalledExactlyOnceWith({
                subreddit: "testsub",
                user: "Troll",
                limit: 100,
            });
            expect(historyLine(lines(onlyMessage(app.slack.messages)))).toBe("• *Last 30 days:* 2 removals, 1 ban");
        },
    );

    it("says so when the notes hold nothing in the window", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);

        await app.fire("ModAction", bannedUser());

        expect(historyLine(lines(onlyMessage(app.slack.messages)))).toBe("• *Last 30 days:* nothing in mod notes");
    });

    it("leaves the history out, and reads no notes, at 0 days", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit, { banHistoryDays: 0 });

        await app.fire("ModAction", bannedUser());

        expect(historyLine(lines(onlyMessage(app.slack.messages)))).toBeUndefined();
        expect(app.context.reddit.getModNotes).not.toHaveBeenCalled();
    });

    it("goes without the history, logged, when the notes cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const app = await loadApp(devvit);
        const failure = new Error("mod notes unavailable");
        app.context.reddit.getModNotes.mockImplementationOnce((): Listing<FakeModNote> => ({
            all: async (): Promise<readonly FakeModNote[]> => await Promise.reject(failure),
        }));

        await app.fire("ModAction", bannedUser());

        expect(historyLine(lines(onlyMessage(app.slack.messages)))).toBeUndefined();
        expect(console.warn).toHaveBeenCalledWith(
            "[modaction] Could not read the user's mod notes, so alerting the ban without their history:",
            failure,
        );
    });
});

describe("mod notes", (): void => {
    it.each([
        ["a ban that is not alerted", { enabledActions: ["unbanuser"] }, bannedUser()],
        ["an action other than a ban", {}, removedPost()],
    ])(
        "are not read for %s",
        TEST_OPTIONS,
        async (_label: string, settings: Readonly<Settings>, event: ReturnType<typeof bannedUser>): Promise<void> => {
            expect.hasAssertions();

            const app = await loadApp(devvit, settings);

            await app.fire("ModAction", event);

            expect(app.context.reddit.getModNotes).not.toHaveBeenCalled();
        },
    );
});
```

In `tests/integration/registration.test.ts`, after `{ name: "includeModNote", type: "boolean", defaultValue: true },` add `{ name: "banHistoryDays", type: "number", defaultValue: 30 },`. In `src/settings/config.test.ts`, add `banHistoryDays: 30,` after `includeModNote: true,`.

Run: `npx vitest run tests/integration/banHistory.test.ts tests/integration/registration.test.ts src/settings/config.test.ts 2>&1 | grep -E "×|Tests "`
Expected: "counts the user's mod notes…", "says so when the notes hold nothing…" and "goes without the history, logged…" fail, as do the registration list and the config defaults. "leaves the history out, and reads no notes, at 0 days" and the "are not read" cases pass already: they pin what must stay true, and Step 10 checks they can fail.

- [ ] **Step 5: Model, ports and use case**

- `src/moderation/domain/modAction.ts`: `import type { RecentHistory } from "./history.js";`, and add to `ModAction` after `activitySpike`:

```ts
    /** For a ban: what the user's mod notes record in the days before it, when read. */
    readonly recentHistory: RecentHistory | undefined;
```

- Add `recentHistory: undefined,` beside `activitySpike: undefined,` in `src/moderation/infrastructure/modActionEvent.ts`, `src/moderation/application/simulateModAction.ts` and `tests/fixtures/modActions.ts` (run `npm run typecheck` to find any other place that builds a `ModAction`).
- `src/moderation/application/ports.ts`: `import type { NoteEntry } from "../domain/history.js";`, and add to `ModerationLookups`:

```ts
    /**
     * The user's entries in the named subreddit's mod notes (the current subreddit's when none is named), newest
     * first, at most 100. Rejects when they cannot be read.
     */
    readonly modNotes: (subredditName: string | undefined, username: string) => Promise<readonly NoteEntry[]>;
```

- `tests/fixtures/moderationPorts.ts`: give the lookups it builds `modNotes: vi.fn(async (): Promise<readonly NoteEntry[]> => await Promise.resolve([]))`, importing `NoteEntry` as a type from `../../src/moderation/domain/history.js` (as the fixture imports the other domain types).
- `src/moderation/application/notifyModAction.ts`: add to `ModerationConfig`

```ts
    /** How many days of the banned user's mod notes a ban alert counts; 0 leaves them out. */
    readonly banHistoryDays: number;
```

import `recentHistory` from `../domain/history.js`, add

```ts
/** A ban, with what the user's mod notes record in the configured days before it; unchanged when off, or on failure. */
async function withRecentHistory(modAction: ModAction, days: number, lookups: ModerationLookups): Promise<ModAction> {
    const username = modAction.target?.author;
    if (actionTypeOf(modAction) !== "banuser" || days === 0 || isBlank(username)) {
        return modAction;
    }
    try {
        const notes = await lookups.modNotes(modAction.subredditName, username);
        return { ...modAction, recentHistory: recentHistory(notes, modAction.occurredAt, days) };
    } catch (error) {
        console.warn(
            "[modaction] Could not read the user's mod notes, so alerting the ban without their history:",
            error,
        );
        return modAction;
    }
}
```

and in `notifyModAction` replace `await ports.alerts.report(modAction, actor);` with

```ts
await ports.alerts.report(await withRecentHistory(modAction, config.banHistoryDays, ports.lookups), actor);
```

- `src/moderation/application/notifyModAction.test.ts`: add `banHistoryDays: 0,` to `CONFIG`.

- [ ] **Step 6: The Reddit adapter**

In `src/moderation/infrastructure/redditModeration.ts`: add `"getModNotes"` to `ModerationReddit`'s `Pick`; import `NoteEntry` and `NoteKind` as types from `../domain/history.js`; add

```ts
/** At most this many of a user's mod notes are read: enough to cover any window a ban alert counts. */
const MOD_NOTES_READ = 100;
/** Reddit's mod note types a ban alert counts, by the kind it counts them as. */
const NOTE_KINDS: ReadonlyMap<string, NoteKind> = new Map([
    ["REMOVAL", "removal"],
    ["SPAM", "spam"],
    ["BAN", "ban"],
    ["MUTE", "mute"],
    ["NOTE", "note"],
]);
```

and to the lookups `createRedditModerationLookups` returns:

```ts
        modNotes: async (subredditName: string | undefined, username: string): Promise<readonly NoteEntry[]> => {
            const subreddit = isBlank(subredditName) ? await reddit.getCurrentSubredditName() : subredditName;
            const notes = await reddit.getModNotes({ subreddit, user: username, limit: MOD_NOTES_READ }).all();
            return notes.map(
                ({ type, createdAt }: Readonly<{ type: string; createdAt: Date }>): NoteEntry => ({
                    kind: NOTE_KINDS.get(type) ?? "other",
                    createdAt,
                }),
            );
        },
```

In `src/composition.ts`, add `"getModNotes"` to `AppContext`'s `reddit` `Pick`.

- [ ] **Step 7: The alert line**

In `src/moderation/infrastructure/slackModActionAlerts.ts`, import `HistoryCounts` and `RecentHistory` as types from `../domain/history.js`, and add before `messageLines`:

```ts
/** The counted kinds, in the order the line gives them, with their names for one and for several. */
const HISTORY_KINDS: readonly Readonly<{ kind: keyof HistoryCounts; one: string; many: string }>[] = [
    { kind: "removal", one: "removal", many: "removals" },
    { kind: "spam", one: "spam removal", many: "spam removals" },
    { kind: "ban", one: "ban", many: "bans" },
    { kind: "mute", one: "mute", many: "mutes" },
    { kind: "note", one: "note", many: "notes" },
];

/** For a ban: what the user's mod notes record in the days before it, as counts. */
function historyLines(history: RecentHistory | undefined): readonly string[] {
    if (history === undefined) {
        return [];
    }
    const counted = HISTORY_KINDS.filter(({ kind }): boolean => history.counts[kind] > 0).map(
        ({ kind, one, many }): string => `${String(history.counts[kind])} ${history.counts[kind] === 1 ? one : many}`,
    );
    const summary = counted.length === 0 ? "nothing in mod notes" : counted.join(", ");
    return [`• *Last ${String(history.days)} days:* ${summary}`];
}
```

and in `messageLines`, after `...detailLines(modAction, presentation.includeModNote),` add `...historyLines(modAction.recentHistory),`.

- [ ] **Step 8: The setting**

- `src/settings/definitions.ts`: export `DEFAULT_BAN_HISTORY_DAYS = 30`; add `const HISTORY_DAYS_PROBLEM = "Enter a whole number of days, 0 or more (0 leaves the history out)";` and

```ts
/** Why the value cannot be a number of days of history: undefined when it is unset, or a whole number of 0 or more. */
function historyDaysProblem(value: number | undefined): string | undefined {
    return value === undefined || (Number.isInteger(value) && value >= 0) ? undefined : HISTORY_DAYS_PROBLEM;
}
```

and after the `includeModNote` entry:

```ts
    {
        type: "number",
        name: "banHistoryDays",
        label: "Ban Alert History (Days)",
        helpText:
            "Ban alerts count the user's entries in Reddit's mod notes (removals, spam removals, bans, mutes and notes) from this many days before the ban, never their text (0 leaves the history out)",
        defaultValue: DEFAULT_BAN_HISTORY_DAYS,
        onValidate: ({ value }: Readonly<{ value?: number | undefined }>): string | undefined =>
            historyDaysProblem(value),
    },
```

- `src/settings/config.ts`: import the default; add to `AppConfig` after `includeModNote`

```ts
    /** How many days of the banned user's mod notes a ban alert counts; 0 leaves them out. */
    readonly banHistoryDays: number;
```

`banHistoryDays: DEFAULT_BAN_HISTORY_DAYS,` in `DEFAULT_CONFIG`, and in `readConfig`'s result:

```ts
        banHistoryDays: nonNegativeInteger(await settings.get("banHistoryDays"), DEFAULT_BAN_HISTORY_DAYS),
```

- `src/composition.ts`: add `banHistoryDays: config.banHistoryDays,` to `moderationConfig`'s result.

- [ ] **Step 9: Run the tests, and update the two that pin a ban's lines**

Run: `npm run typecheck && npx vitest run 2>&1 | grep -E "×|Tests "`
Expected: everything passes except the tests that pin a ban alert's exact lines, which now end with the history line:

- `tests/integration/bans.test.ts`, "takes its duration and reason from the matching mod log entry": append `"• *Last 30 days:* nothing in mod notes",` to the expected lines.
- `tests/integration/banModNotes.test.ts`: append `"• *Last 30 days:* nothing in mod notes"` to both rows' expected lines.

Run again. Expected: all pass.

- [ ] **Step 10: Check the new tests can fail**

Temporarily change `days === 0` in `withRecentHistory` to `days < 0`, run `npx vitest run tests/integration/banHistory.test.ts`, and expect "leaves the history out, and reads no notes, at 0 days" to fail; restore it. Temporarily delete `time >= end ||` in `recentHistory`, run `npx vitest run src/moderation/domain/history.test.ts`, expect "leaves out notes older than the window, and the action's own" to fail; restore it.

- [ ] **Step 11: Docs**

- `README.md`: in **Ban and mute context**, add: "A ban alert also counts what Reddit's mod notes record about the user in the 30 days before (removals, spam removals, bans, mutes and notes), without their text." Settings row after Include Mod Note: `| Ban Alert History (Days) | How many days of the user's mod notes a ban alert counts; 0 leaves the history out. | 30 |`.
- `OPERATORS-GUIDE.md`: configuration row (`banHistoryDays`, "a whole number of 0 or more"); under "Mod action alerts", the alert contents line for bans gains "and the user's mod-note history over Ban Alert History days, as counts"; a step after **Who acted** saying that for an alerted ban the app reads up to 100 of the user's mod notes; the log table gains `[modaction] Could not read the user's mod notes …` ("Reddit couldn't return the user's mod notes; the ban was alerted without its history").
- `PRIVACY-POLICY.md`: in "What it reads", a row `| Ban history | When a ban is alerted: the banned user's entries in the subreddit's mod notes from the days before it (30 by default): their kinds and dates, not their text. | To show the ban in context. |`; under "What it sends", the ban bullet gains "and how many removals, spam removals, bans, mutes and notes the user's mod notes record in the days before it". Nothing new is kept.

- [ ] **Step 12: Format, lint, commit**

Run: `npx prettier --write src tests README.md OPERATORS-GUIDE.md PRIVACY-POLICY.md && npm run lint && npm run format:check`

```bash
git add src tests README.md OPERATORS-GUIDE.md PRIVACY-POLICY.md
git commit -m "Show the user's recent mod-note history in ban alerts" -m "An alerted ban reads up to 100 of the user's entries in Reddit's mod notes and counts, by kind, those from the Ban Alert History days before it (banHistoryDays, 30 by default): removals, spam removals, bans, mutes and notes. Never their text; nothing is kept. When the notes cannot be read, the ban is alerted without them." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Phase check

- [ ] **Step 1: Every CI step**

Run: `npm ci && npm run typecheck && npm run coverage && npm run lint && npm run format:check`
Expected: all pass. (`npm ci` fails with EPERM while a `devvit playtest` holds `esbuild.exe`: ask the owner to stop it first.)

- [ ] **Step 2: Docs agree with the code**

Run: `grep -n "31 action types\|any of 31" README.md OPERATORS-GUIDE.md` and expect nothing. Read the settings tables in README.md and OPERATORS-GUIDE.md against `src/settings/definitions.ts`: every setting, in form order, with its default.

- [ ] **Step 3: Hand the playtest to the owner**

Ask the owner to check, in a playtest:

1. Change a moderator's permissions: a security alert arrives in the alert channel.
2. Ban a user who has removals in their mod notes: the alert ends with "Last 30 days: …", and nothing logs "Could not read the user's mod notes". If it does, `getModNotes` is rejecting notes in Devvit 0.15 (the design's playtest facts): record it before Phase 3.
3. With Spam Queue Size Alert Threshold at 1 and something in the spam queue, run Setup Modqueue Monitoring and wait for a run: a spam queue alert arrives.

- [ ] **Step 4: Push and open the pull request, when the owner asks**

Check `gh api user --jq .login` prints `ivashkin-reddit`, then push the branch and open the pull request against `main` with `--repo ivashkin-reddit/mod-action-notifications`, its body in the repository's PR template (Summary, Evidence, Merge Danger) and ending `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
