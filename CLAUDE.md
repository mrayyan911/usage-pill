# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Usage Pill: a frameless, transparent, always-on-top Electron overlay (Dynamic-Island style, user-draggable, launches top-center of the primary display) showing real-time Claude Code / Codex usage — one animated bar, one percentage, one agent icon. It auto-follows whichever agent (Claude or Codex) is actively in use and animates only while that agent is mid-turn. No build step, no frontend framework.

## Commands

```
npm install
npm test                     # runs the files listed in package.json's "test" script
USAGE_PILL_MOCK=1 npm start  # scripted demo of every state/threshold, no real usage needed
npm start                    # real data (reads live Claude/Codex usage)
```

`USAGE_PILL_DEBUG=1` (combine with either `npm start` variant) logs every pushed state change to the terminal as JSON — the fastest way to inspect what the reducer is doing without eyeballing the pill.

Tests use Node's built-in `node:test` (no Jest/Mocha) and are **explicitly listed** in `package.json`'s `test` script rather than globbed — a new test file must be added there or `npm test` silently won't run it. To run one file directly: `node --test test/reduce.test.js`.

## Architecture

The whole app is one data pipeline, wired up in `src/main/index.js`:

```
ActivityStore.poll()  ──┐
                         ├──> Reducer._tick() ──> reduce() ──> onChange (dedup'd) ──> IPC 'pill:state' ──> pill.js render()
UsageStore (Claude/Codex)┘
```

- **`stores/activity.js` (`ActivityStore`)** polls both agents every tick (`Reducer`'s `tickMs`, ~400ms) and arbitrates staleness: a `working`/`blocked` reading whose source file hasn't changed in `STALE_MS` (180s — empirically the longest observed real tool call) triggers a rate-limited (`processCheck.js`, min 10s between probes) `tasklist` liveness check before forcing the state to `idle`. Whichever agent's source file has the newer mtime becomes the single `active` agent reported to the renderer.
- **`stores/usage.js` (`UsageStore`)** owns the two usage percentages. Claude's comes over HTTP on a 60s cadence plus an edge-triggered refetch the tick after a turn finishes (percent only moves on turn completion); Codex's rides the same free local file scan its activity check already does, so it's refreshed every tick with no separate schedule. Both track `stale`/`error`/`unauthenticated` status with backoff on HTTP failures.
- **`reduce.js`** is a pure function (`reduce()`) merging one `ActivityStore` snapshot + both usage getters into the single shape the renderer consumes, wrapped by `Reducer`, which owns the tick loop and only calls `onChange` when the JSON-serialized state actually differs from the last push.
- **`mock.js` (`MockDriver`)** replaces the whole pipeline above under `USAGE_PILL_MOCK=1`, stepping through a scripted `SCRIPT` array of every state/threshold combo — this is how the animations get visually tuned without needing real usage data.
- **`stores/config.js` (`ConfigStore`)** is the single source of truth for the pill's geometry (collapsed/expanded width & height, top margin); `window.js` calls `ConfigStore.topCenterBounds()` for the default launch position, `ConfigStore.clampToWorkArea()` to hard-clamp a dragged position to whichever display's work area it's currently over, and derives its hover hit-test region from the same constants.

### Two independent activity/usage detection paths

**Claude:**
- Primary signal: `hooks/activity-hook.js` (installed into `~/.claude/settings.json`, see README's "How activity detection works") appends one line per hook event to an append-only `activity.jsonl` under `%LOCALAPPDATA%/usage-pill/`. `parsers/activityLog.js` replays it as a small state machine (`start`/`subagent_start`/`subagent_stop`/`blocked`/`end`/`session_end`) that distinguishes "blocked on a permission prompt" from "tool running" — something a transcript alone can't. Hook changes only apply from the *next* Claude Code session onward.
- Fallback (pre-hook sessions, or hooks disabled): `providers/claudeActivity.js` tails the newest `.jsonl` per project dir under `~/.claude/projects/`, and `parsers/claudeTranscript.js` walks it backward interpreting `stop_reason`/`tool_result`/sidecar-record rules (see the doc comment in that file — it encodes several non-obvious "ground truth verified against real transcripts" facts, e.g. a family of sidecar record types carry no `timestamp` and must be ignored entirely).
- `stores/activity.js`'s `readClaudeState()` picks hook-vs-fallback per read (prefers the hook log whenever it has a real timestamp).

**Codex:** no turn-start hook exists, so both activity *and* usage come from one backward-scan-friendly pass (`providers/codex.js` `readCodexSnapshot()` → `parsers/codexRollout.js`) over today's + yesterday's rollout files under `~/.codex/sessions/YYYY/MM/DD/`.
- **Critical invariant:** a session's `rate_limits` are only trustworthy from its root/user thread (`payload.parent_thread_id == null && thread_source === 'user'`) — a subagent thread's `rate_limits` are a stale/partial snapshot and must never be used for the usage percentage.
- Subagent *activity* still counts, though (a running subagent means Codex is genuinely working). See `test/parsers.test.js`'s "subagent trap" test for why this matters.

**Claude's usage** (separate from its activity) comes from `providers/claude.js`, which reads the OAuth access token fresh from `~/.claude/.credentials.json` on every call and never attempts its own token refresh (that's Claude Code's job — racing it would invalidate the user's session).

### Shared low-level helpers

- `fsUtil.js`: `readTail` (reads only the last 64KB of a file — session files only grow, so this avoids re-reading whole transcripts), `statOrNull`, `newestFileIn` (newest file in a dir matching a prefix/suffix, with an authoritative per-file `statSync` rather than trusting `readdir`'s dirent, which can be stale on Windows). Prefer these over ad hoc `fs.readdirSync`/`fs.statSync` scans — see git history for a case where a hand-rolled duplicate of `newestFileIn` silently dropped its `isFile()` guard.
- `usageShape.js`: the shared `EMPTY_USAGE` shape (`{percent, resetsAt, weeklyPercent, planType}` all null) both providers and the usage store spread into their status-specific returns — reuse it rather than hand-copying the literal.

### Renderer (`src/renderer/`, `src/preload.js`)

No framework, no build step. `preload.js` is the *only* bridge between main and renderer (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`), exposing `window.usagePill.onState`/`onHover`. `pill.js` is one IPC listener driving DOM class toggles and a walk-cycle glyph animation; per-agent color is a single `--agent-color` CSS custom property write (`pill.js`) consumed declaratively by `pill.css` for both the icon and bar-fill, with `.bar-fill.amber`/`.red` classes overriding it above threshold via specificity — don't reintroduce imperative `style.backgroundColor` branching here. `icons.js` procedurally builds pixel-sprite SVGs (not embedded brand logos) so Claude/Codex get distinct silhouettes without any image assets or trademark risk.

### `window.js`: Windows-specific Electron gotchas already solved

Several non-obvious platform fixes are baked in and documented inline — don't "simplify" them without reading the comments first: `frame: false` is mandatory for `transparent: true` to work on Windows; `alwaysOnTop` must be reasserted at level `'screen-saver'` (the default `'floating'` sits *below* the taskbar on Windows); the window is sized for its *expanded* state up front since a transparent window can't resize without a visible flash; hover is detected by polling `screen.getCursorScreenPoint()` from the main process rather than CSS `:hover` (unreliable across the transparent surface); bounds are recomputed on every display-added/removed/metrics-changed event for monitor-hotplug recovery.

## Contributing conventions (see `CONTRIBUTING.md` for full detail)

- Branch off `main` as `<type>/<short-kebab-case-description>` (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`); one logical change per branch; PRs merge via squash.
- **No comments explaining *what* code does** — only non-obvious *why* (platform quirks, workarounds, invariants that would surprise a reader). Names should carry the *what*.
- Minimal-fix over refactor: a bug fix shouldn't restyle the file around it.
- Prefer CSS/styling changes over structural changes for rendering issues — the visual layer (`src/renderer/pill.css`) should do as much of the work as possible so `src/main`'s logic layer stays untouched.
- New parsing logic gets a fixture in `test/fixtures/` + a test in `test/parsers.test.js`, not an inline mock. **Fixtures must be synthetic or scrubbed** — never commit a real captured transcript/rollout line with a real `cwd`, session id, or timestamp.
- If you touch `src/main/window.js` or `src/renderer/*`, actually run `npm start` (or mock mode) and look at the pill — unit tests cover the parsers/reducer/state machine, not the rendered UI.

## Commit/PR rules

- **No AI attribution.** Don't add `Co-Authored-By: Claude`, "Generated with Claude Code", or any similar AI-attribution line to commit messages or PR descriptions in this repo.

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues (`mrayyan911/usage-pill`), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout (root `CONTEXT.md` + `docs/adr/`). See `docs/agents/domain.md`.
