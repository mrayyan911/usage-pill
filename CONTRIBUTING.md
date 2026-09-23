# Contributing

## Setup

```
npm install
npm test                     # 143 unit tests, no Electron runtime needed
npm run test:renderer        # optional Electron animation regression
USAGE_PILL_MOCK=1 npm start  # scripted demo of every state/threshold, no real usage needed
npm start                    # real data (reads live Claude/Codex usage)
```

The renderer regression requires the Electron binary installed by `npm install`
and an environment capable of running Electron with a display. Run it from a
desktop session; it is separate from `npm test` so the unit suite stays usable
without a GUI. Headless Linux needs Electron's system libraries and a display
server such as Xvfb.

`USAGE_PILL_DEBUG=1` (combine with either `npm start` variant) logs every
state change to the terminal — the fastest way to see what the reducer is
doing without staring at the pill itself.

## Branching

Branch off `main` using `<type>/<short-kebab-case-description>`:

| Type       | Use for                                      | Example                          |
|------------|-----------------------------------------------|-----------------------------------|
| `feat/`    | New behavior or UI                            | `feat/hover-expand-transitions`   |
| `fix/`     | Bug fixes                                     | `fix/pill-corner-radius`          |
| `chore/`   | Tooling, deps, config, no behavior change     | `chore/bump-electron`             |
| `docs/`    | Documentation only                            | `docs/contributing-branch-style`  |
| `refactor/`| Internal restructuring, no behavior change    | `refactor/reducer-state-shape`    |
| `test/`    | Test-only changes                             | `test/codex-rollout-fixtures`     |

Guidelines:

- One logical change per branch — if a PR description needs "and" to
  summarize it, it's two branches.
- Keep branches short-lived: rebase onto `main` rather than merging `main`
  into your branch, so history stays linear and easy to bisect.
- Delete the branch once it's merged.
- Commit messages follow the same intent as the branch type where it makes
  sense (`fix: correct pill corner radius on expand`), imperative mood,
  no trailing period on the subject line.
- PRs merge via **squash and merge** on GitHub — commit hygiene on the
  branch itself doesn't need to be pristine, but the squashed message
  landing on `main` does.

## Before opening a PR

- `npm test` passes.
- If you touched `src/main/window.js` or `src/renderer/*`, actually run
  `npm start` (or mock mode) and look at the pill — the unit tests cover the
  parsers/reducer/state machine, not the rendered UI.
- New parsing logic gets a fixture in `test/fixtures/` and a test in
  `test/parsers.test.js`, not a mock inline in the test file — see the
  existing fixtures for the shape.
- Fixtures must be synthetic or scrubbed. Don't commit a real captured
  transcript/rollout line with a real `cwd`, session id, or timestamp in it.

## Code style

- No comments explaining *what* code does — names should already say that.
  A comment is for a non-obvious *why* (a platform quirk, a workaround, an
  invariant that would surprise a reader).
- Minimal-fix over refactor: a bug fix shouldn't restyle the file around it.
- CSS/styling changes are preferred over structural changes when either
  would fix a rendering issue (see `src/renderer/pill.css` for the pattern:
  the visual layer does as much work as possible so the main-process/logic
  layer stays untouched).

## Project shape (for orientation)

- `src/main/` — Electron main process: window creation, the activity/usage
  stores, the reducer that turns them into one render-able state, parsers
  for Claude transcripts and Codex rollout files.
- `src/renderer/` — the pill's HTML/CSS/JS. No framework, no build step.
- `src/preload.js` — the only bridge between them (`contextIsolation` is on).
- `hooks/activity-hook.js` — invoked by Claude Code's own hooks (see
  README's "How activity detection works"); keep it dependency-free and
  never let it throw or block Claude Code.

## Releasing to npm

`bin/usage-pill.js` is the global-install entry point (`package.json`'s
`bin.usage-pill`); `scripts/cliArgs.js` maps its subcommands to the same
flags `src/main/index.js` already parses, shared with
`scripts/manage-startup.js`. Publishing is a manual, one-time-per-release
step requiring a maintainer's authenticated npm session — bump `version` in
`package.json`, then run `npm publish --access public` (the package name is
scoped, `@mrayyan911/usage-pill`, so `--access public` is required on first
publish). Nothing in the dev workflow (`npm start`, tests) depends on this.

## Reporting bugs

Open an issue with what you expected, what happened, and — if it's visual —
a screenshot. `USAGE_PILL_MOCK=1 USAGE_PILL_DEBUG=1 npm start` is usually the
fastest way to build a minimal repro since it doesn't depend on your real
usage state.
