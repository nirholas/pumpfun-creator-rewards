# AGENTS.md

Operating notes for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repository. Everything here is derived from the files actually in the tree, so trust it over guesses, and update it when the facts change.

## What this repository is

Look up Pump.fun creator-reward earnings by coin mint, wallet address, or username.  Single-page web app with a JSON API. Live data, no mocks. Deploys to Vercel.

- Homepage: https://nirholas.github.io/pumpfun-creator-rewards/
- Source: https://github.com/nirholas/pumpfun-creator-rewards
- Primary language: JavaScript
- License: Other (see the LICENSE file)

## Repository layout

- `api/`
- `docs/`
- `lib/`
- `src/`
- `README.md`
- `LICENSE`
- `package.json`
- `Dockerfile`

## Setup

```bash
npm install
```

## Commands

| Task | Command |
|---|---|
| dev | `npm run dev` |
| start | `npm start` |
| build | `npm run build` |
| build image | `docker build .` |

Run the test and lint commands above before you consider a change finished. If a command fails on code you did not touch, say so in your report instead of silently skipping it.

## Conventions

- `.env` files are gitignored; never commit credentials, and read configuration from environment variables.
- Commit messages follow Conventional Commits (`type(scope): summary`), matching the existing history.
- Read the surrounding code before adding to it, and match its naming, file organisation and error-handling style.
- Keep `README.md` accurate: if a change alters behaviour, commands or configuration, update the docs in the same commit.
- Do not leave TODO comments, stub functions, placeholder data or commented-out code behind. Finish what you start or leave it out.
- Small, focused commits with a subject line that describes the change, not the act of committing.

## Where to raise things

- Bugs and feature requests: https://github.com/nirholas/pumpfun-creator-rewards/issues
- Questions and ideas: https://github.com/nirholas/pumpfun-creator-rewards/discussions
- Security issues: report privately at https://github.com/nirholas/pumpfun-creator-rewards/security/advisories/new, never in a public issue.
