# AGENTS.md

## Git

Commits are authored and committed as `ivashkin-reddit <ivashkin.r@pm.me>`; pushes and `gh` calls run as the `ivashkin-reddit` GitHub account. Local hooks enforce this: when one rejects, correct the identity and retry.

## Dependencies

`typescript` stays on `~6.0`: TypeScript 7 drops the compiler API that typescript-eslint parses with. Move to 7 once a typescript-eslint release's `typescript` peer range includes it.
