# AGENTS.md

## Git

Commits are authored and committed as `ivashkin-reddit <ivashkin.r@pm.me>`; pushes and `gh` calls run as the `ivashkin-reddit` GitHub account. Local hooks enforce this: when one rejects, correct the identity and retry.

## Dependencies

`typescript` stays on `~6.0`: TypeScript 7 drops the compiler API that typescript-eslint parses with. Move to 7 once a typescript-eslint release's `typescript` peer range includes it.

## Tests

- A change is done when `npm run type-check`, `npm run lint` and `npm run coverage` pass. `coverage` fails below 90% statement, branch, function or line coverage of `src/`.
- The suite in [tests/](tests) reaches the app only through what it registers with `Devvit`: [tests/support/fakeDevvit.ts](tests/support/fakeDevvit.ts) records the settings, triggers, scheduler job, forms and menu items, and tests call those handlers with real-shaped events. Restructuring `src/` keeps the suite green as long as the app registers the same things.
- Setting names and Redis keys are stored data: renaming one loses what installations already saved. The tests pin them.
- Some tests pin behaviour that looks wrong, and say so in their names or comments: the ModAction time ignores `actionedAt`, cached posts store their author and subreddit as `Unknown`, a plural "days" is not parsed as a ban length, and the Test Slack Connection form reports success whatever happens. Change one only as a deliberate behaviour fix, together with its test.
- `npm run playtest` (`devvit playtest`) is the only check against Reddit itself and needs the user's Reddit login: hand that step to the user, naming what to exercise.
