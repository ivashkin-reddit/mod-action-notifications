# AGENTS.md

## Git

Commits are authored and committed as `ivashkin-reddit <ivashkin.r@pm.me>`; pushes and `gh` calls run as the `ivashkin-reddit` GitHub account. Local hooks enforce this: when one rejects, correct the identity and retry.

## Dependencies

`typescript` stays on `~6.0`: TypeScript 7 drops the compiler API that typescript-eslint parses with. Move to 7 once a typescript-eslint release's `typescript` peer range includes it.

## Architecture

A modular monolith on Devvit Blocks: one module per business capability, two shared modules, and a composition root. `npm run lint` enforces the import rules below (the `boundary` blocks in [eslint.config.js](eslint.config.js)).

| Module | Owns | Redis keys |
| --- | --- | --- |
| [src/moderation/](src/moderation) | Mod-action alerts: unknown moderators, activity spikes, ban and mute reminders, the simulation form | `mod_actions:moderator_activity:*`, `mod_actions:discipline:*` |
| [src/modqueue/](src/modqueue) | The modqueue monitor job and its queue, age and failure alerts | `modqueue_monitor_job_id`, `mod_actions:throttle:*`, `scheduler_failure_count` |
| [src/postDeletion/](src/postDeletion) | Alerts when a user deletes a high-score post | `post_score:*` |
| [src/settings/](src/settings) | The settings form and the validated `AppConfig` | |
| [src/slack/](src/slack) | The Slack message format and webhook delivery | |
| [src/main.ts](src/main.ts), [src/composition.ts](src/composition.ts) | The composition root: `main.ts` registers handlers with Devvit and shows toasts; `composition.ts` builds each handler's adapters from its context | |

- Dependencies point one way: composition root → capabilities → `slack`. Capabilities import neither each other nor `settings`: each declares its own config type, and `composition.ts` maps `AppConfig` onto it.
- Code outside a module imports it only through its `index.ts`.
- Inside a capability, dependencies point inward:
  - `domain/` holds pure rules and imports nothing outside itself.
  - `application/` holds use cases and `ports.ts`, the interfaces for what they need from outside (storage, Reddit lookups, alerts). It imports only its domain.
  - `infrastructure/` holds adapters: ports implemented with Devvit's Redis, Reddit and scheduler and with Slack, and translations of Devvit events and forms into domain types.
  - Only `infrastructure/` may import from Devvit, and only types. Only `main.ts` imports `Devvit` itself.
- A port is for something outside the process. Logic that needs no I/O goes in `domain/` and is called directly.
- To add a capability: create its folder with the three layers and an `index.ts`, add its name to `CAPABILITIES` in [eslint.config.js](eslint.config.js), wire it in `composition.ts` and register its handlers in `main.ts`. A new trigger also goes in `blocks.triggers` in [devvit.json](devvit.json); a test checks the two match.

## Tests

- A change is done when `npm run type-check`, `npm run lint` and `npm run coverage` pass. `coverage` fails below 90% statement, branch, function or line coverage of `src/`.
- The suite in [tests/](tests) reaches the app only through what it registers with `Devvit`: [tests/support/fakeDevvit.ts](tests/support/fakeDevvit.ts) records the settings, triggers, scheduler job, forms and menu items, and tests call those handlers with real-shaped events. Restructuring `src/` keeps the suite green as long as the app registers the same things.
- Setting names and Redis keys are stored data: renaming one loses what installations already saved. The tests pin them.
- Some tests pin behaviour that looks wrong, and say so in their names or comments: the ModAction time ignores `actionedAt`, cached posts store their author and subreddit as `Unknown`, a plural "days" is not parsed as a ban length, and the Test Slack Connection form reports success whatever happens. Change one only as a deliberate behaviour fix, together with its test.
- `npm run playtest` (`devvit playtest`) is the only check against Reddit itself and needs the user's Reddit login: hand that step to the user, naming what to exercise.
