# AGENTS.md

## Git

Commits are authored and committed as `ivashkin-reddit <ivashkin.r@pm.me>`; pushes and `gh` calls run as the `ivashkin-reddit` GitHub account. Local hooks enforce this: when one rejects, correct the identity and retry.

## Done

A change is done when every step in [.github/workflows/test.yml](.github/workflows/test.yml) passes locally.

`npm run playtest` (`devvit playtest`) is the only check against Reddit itself and needs the user's Reddit login: hand that step to the user, naming what to exercise.

## Architecture

A modular monolith on Devvit Blocks: one module per business capability, two shared modules, and a composition root.

| Module                                                               | Owns                                                                                                                                              | Redis keys                                                                                     |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [src/moderation/](src/moderation)                                    | Mod-action alerts: unknown moderators, activity spikes, ban and mute reminders, the simulation form                                               | `mod_actions:moderator_actions:*`, `mod_actions:discipline_events:*`, `mod_actions:reported:*` |
| [src/modqueue/](src/modqueue)                                        | The modqueue monitor job and its queue, age and failure alerts                                                                                    | `mod_actions:throttle:*`, `scheduler_failure_count`                                            |
| [src/postDeletion/](src/postDeletion)                                | Alerts when a user deletes a high-score post, reading its score from Reddit at deletion                                                           | `post_deletion:alerted:*`                                                                      |
| [src/settings/](src/settings)                                        | The settings form and the validated `AppConfig`                                                                                                   |                                                                                                |
| [src/slack/](src/slack)                                              | The Slack message format, the alert outbox (a queue delivered at Slack's pace) and webhook delivery                                               | `slack_outbox*`                                                                                |
| [src/main.ts](src/main.ts), [src/composition.ts](src/composition.ts) | The composition root: `main.ts` registers handlers with Devvit and shows toasts; `composition.ts` builds each handler's adapters from its context |                                                                                                |

- Dependencies point one way: composition root → capabilities → `slack`. Capabilities import neither each other nor `settings`: each declares its own config type, and `composition.ts` maps `AppConfig` onto it.
- Code outside a module imports it only through its `index.ts`. The one exception is `slack/delivery.ts`, which only the composition root may import: it holds the outbox, the direct sender and the test message. Capability adapters import the message format from `slack/index.ts` and send through the `SlackSender` they are given.
- Inside a capability, dependencies point inward:
    - `domain/` holds pure rules and imports nothing outside itself: no library, Node or Devvit.
    - `application/` holds use cases and `ports.ts`, the interfaces for what they need from outside (storage, Reddit lookups, alerts). It imports only its own application files and its domain.
    - `infrastructure/` holds adapters: ports implemented with Devvit's Redis, Reddit and scheduler and with Slack, and translations of Devvit events and forms into domain types.
- Adapters, the shared modules and `composition.ts` import Devvit's types only. Only `main.ts` imports `Devvit` itself.
- The mod action types the app knows live once, in the moderation module's `actionCatalog.ts`. The settings form and the Simulate Mod Action form offer choices from it.
- A port is for something outside the process. Logic that needs no I/O goes in `domain/` and is called directly.
- Devvit runs handlers concurrently, can deliver an event twice, and serves several installations from one process:
    - Change Redis state with single atomic commands (`SET NX`, sorted sets, `INCRBY`), never a read followed by a write.
    - An alert a trigger sends is claimed by the event's ID (`SET NX`, for a day) just before it is queued, so an event delivered again alerts once. A claim that cannot be stored still sends: a second alert is better than none.
    - Process-wide state, such as the last good settings, is keyed by installation (`subredditId`).
    - The scheduler says which monitor jobs exist: setup reconciles against `listJobs`, and Show Bot Status reads it. No job ID is kept in Redis.
- Alerts go to Slack through the outbox (`createSlackOutbox`): Slack takes about one message a second from a webhook, and the outbox delivers a burst in full at that pace. Its `SlackSender` returns nothing, as delivery may come later. A `DirectSlackSender` (`createWebhookSender`) returns whether Slack accepted the message, and is only for a moderator waiting on the result, such as Simulate Mod Action.
- Every menu item and form checks that the user who invokes it moderates the subreddit (`forModerators` in `main.ts`): Devvit only hides a `forUserType: "moderator"` menu item from other users, and runs its handler for anyone.
- The outbox lease outlasts the longest drain (its budget, a pause and Devvit's 30-second fetch timeout), and a drain that finds work schedules a recovery drain for after its lease, so alerts a drain killed mid-delivery left queued are still delivered.
- Alerts quote Reddit content (titles, and up to 200 characters of a removed comment's or post's text) and link to it, and content later deleted from Reddit stays in Slack: a webhook cannot delete what it posted. This is the owner's deliberate decision for a private moderation app, taken knowing Devvit's rules ask apps to delete such content from external services ("Post/Comment Deletions" in the Devvit rules). Change it only when the owner asks.
- Ban and mute records are kept for 90 days, as moderation metadata: also the owner's decision, against Reddit's recommendation of 30 days for user data.
- Text the app did not write (post and comment content, titles, usernames, mod notes, error messages) goes into Slack through `escapeText` or `quote` in [src/slack/](src/slack): Slack reads `<!channel>` as a mention of everyone.
- [eslint/architecture.mjs](eslint/architecture.mjs) enforces these rules with eslint-plugin-boundaries and `import-x/no-cycle`. It also bars I/O globals (`fetch`, timers) from `domain/` and `application/`, and stops integration tests from mocking `src/` modules by path. [tests/integration/architecture.test.ts](tests/integration/architecture.test.ts) checks that each rule still fires, and that `src/` keeps the layout the rules assume: boundaries assigns a file to the nearest folder it recognises, so a file beside a capability's layers would escape them. A new rule gets a case in [tests/integration/architectureCases.ts](tests/integration/architectureCases.ts).
- `import-x/no-cycle` skips type-only imports, which leave nothing at run time, so a cycle made only of `import type` goes unreported. Boundaries still checks the direction of type imports between layers and modules.
- To add a capability: create its folder with an `index.ts` and the three layers and nothing else, wire it in `composition.ts` and register its handlers in `main.ts`. A new trigger also goes in `blocks.triggers` in [devvit.json](devvit.json); a test checks the two match. A new shared module joins `SHARED_MODULES` in the architecture test and gets a policy saying who may import it.

## Tests

- Tests are placed by scope:
    - A unit test, of one module file, sits beside it as `<file>.test.ts`, in a layer or a shared module. It may import its own module, `tests/fixtures/` and libraries, and nothing imports it. The composition root has none: the integration suite covers it.
    - An integration test goes in [tests/integration/](tests/integration). It reaches the app only through what the app registers with `Devvit`: [tests/fixtures/fakeDevvit.ts](tests/fixtures/fakeDevvit.ts) records the settings, triggers, scheduler jobs, forms and menu items, and tests call those handlers with real-shaped events. Restructuring `src/` keeps this suite green as long as the app registers the same things. Every test today is one of these, however narrow its subject, as each runs the whole app through `main.ts`.
    - [tests/fixtures/](tests/fixtures) holds what tests share: the app harness (`app.ts`), the fakes of Devvit, Reddit, Redis and Slack, event and queue builders, and assertion helpers.
    - There are no end-to-end tests: the app has no client, and `npm run playtest` is the check against Reddit itself.
- Setting names, Redis keys and scheduler job names are stored data: renaming one loses what installations already saved. The tests pin them. A stored value that changes shape takes a new key, and the app reads the old key until it has expired everywhere, as `legacyDisciplineKey` in [redisModerationRecords.ts](src/moderation/infrastructure/redisModerationRecords.ts) does.
- Some tests pin behaviour that looks wrong, and say so in their names or comments: a plural "days" is not parsed as a ban length (harmless, as the text is then shown as written). Change one only as a deliberate behaviour fix, together with its test.
- `eslint --fix` on tests rewrites `toHaveBeenCalled()` and `toHaveBeenCalledTimes(1)` into `toHaveBeenCalledWith()` and `toHaveBeenCalledExactlyOnceWith()`, which assert the mock received no arguments. Write the expected arguments by hand instead.

## Strictness

- Prettier owns formatting: `npm run format` writes it. ESLint carries no formatting rules (eslint-config-prettier), and [.gitattributes](.gitattributes) keeps LF line endings so the check also passes on Windows checkouts.
- [eslint.config.mjs](eslint.config.mjs) starts from every rule (ESLint `all`, typescript-eslint `all` plus its strict and stylistic typed presets, import-x, regexp, eslint-comments, vitest `all`); the files in [eslint/](eslint) tighten them by concern and turn a rule off only with its reason beside it. A dependency upgrade can add rules; fix their findings as part of the upgrade.
- Every suppression or workaround carries a `WORKAROUND:` block (`cause`, `blocked`, `fix`, `until`) directly above it; `grep -rn "WORKAROUND:" --exclude-dir=node_modules .` is the ledger. The only allowed directive is `eslint-disable-next-line` with a `--` reason.
- Adapters take narrow `Readonly<Pick<…>>` context types that name only the Devvit methods they call, and Devvit's real context satisfies them. Tests build typed fakes from [tests/fixtures](tests/fixtures), with no `as` casts.

## Dependencies

Dependabot proposes updates ([.github/dependabot.yml](.github/dependabot.yml)): one weekly pull request for minor and patch versions, one per major version, and one for GitHub Actions.

`typescript` stays on `~6.0`, and the Dependabot config holds it there: TypeScript 7 drops the compiler API that typescript-eslint parses with. Move to 7 once a typescript-eslint release's `typescript` peer range includes it.
