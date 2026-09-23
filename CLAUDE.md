# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Usage Pill: a frameless, transparent, always-on-top Electron overlay (Dynamic-Island style, user-draggable, launches top-center of the primary display) showing real-time Claude Code / Codex usage — an animated bar, a percentage, and an agent badge per active agent. It shows one row for whichever agent is active, and both simultaneously (two badges, two bars) when Claude and Codex are busy at the same time; each row animates only while that agent is mid-turn. Hover the collapsed pill to expand it in place, iOS-Dynamic-Island style. No build step, no frontend framework.

## Visual source of truth

The small reference screenshot is the visual authority, as specified in [the design verdict](docs/qa/Verdits/dynamic-island-agent-ui-design-verdict.md). The large `docs/design/usage-pill design.png` board communicates state structure only, never scale, spacing, borders, glow, or icon sizes. See [the current dimensions and rendered state board](docs/design/README.md).

Keep the surface almost black, its boundary barely visible, icons optically balanced, and expanded rows dense. No outer glow, luminous perimeter, or circular avatar tiles. Collapsed means presence; expanded means information.

## Commands

```
npm install
npm test                     # runs the files listed in package.json's "test" script
USAGE_PILL_MOCK=1 npm start  # scripted demo of every state/threshold, no real usage needed
npm start                    # real data (reads live Claude/Codex usage), always visible
npm run monitor              # native-Windows automatic mode: hidden until a session opens
npm run setup                # register the monitor to launch at Windows login
npm run setup:remove         # unregister it
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

- **`stores/activity.js` (`ActivityStore`)** polls both agents every tick (`Reducer`'s `tickMs`, ~400ms) and arbitrates staleness: a `working`/`blocked` reading whose source file hasn't changed in `STALE_MS` (180s — empirically the longest observed real tool call) triggers a rate-limited (`processCheck.js`, min 10s between probes) `tasklist` liveness check before forcing the state to `idle`. Whichever agent's source file has the newer mtime becomes `active` (used as row order); both agents' individual states are still reported. `active` is sticky while the current active agent stays busy -- without that, two genuinely-concurrent busy agents can leapfrog each other's mtime almost every tick, flipping row order that often (see the renderer note below for why that specifically matters).
- **`stores/usage.js` (`UsageStore`)** owns the two usage percentages. Claude's comes over HTTP on a 60s cadence plus an edge-triggered refetch the tick after a turn finishes (percent only moves on turn completion); Codex's rides the same free local file scan its activity check already does, so it's refreshed every tick with no separate schedule. Both track `stale`/`error`/`unauthenticated` status with backoff on HTTP failures.
- **`reduce.js`** is a pure function (`reduce()`) merging one `ActivityStore` snapshot + both usage getters into `{agents, primary}` -- one `agents` row normally (whichever is `active`), two only when Claude and Codex are both `working`/`blocked` at the same time (`primary` first). Wrapped by `Reducer`, which owns the tick loop and only calls `onChange` when the JSON-serialized state actually differs from the last push.
- **`mock.js` (`MockDriver`)** replaces the whole pipeline above under `USAGE_PILL_MOCK=1`, stepping through a scripted `SCRIPT` array of every state/threshold combo — this is how the animations get visually tuned without needing real usage data.
- **`stores/config.js` (`ConfigStore`)** is the single source of truth for the pill's geometry (collapsed/expanded width & height, top margin). `placement.js` calls `ConfigStore.pillHitRect()` to hover-hit-test against the pill's actual on-screen size rather than the larger pre-sized OS window, and `ConfigStore.clampWindowToVisiblePill()` (built on the lower-level `clampToWorkArea()`) to hard-clamp a dragged position so the *visible pill*, not the invisible window around it, stays within whichever display's work area it's currently over. `ConfigStore.resolveLaunchBounds()` picks the actual launch position -- a saved drag position (re-clamped via `clampToWorkArea()`) if `stores/position.js`'s `PositionStore` has one on a still-connected display, else `topCenterBounds()`.
- **`stores/position.js`** (`PositionStore`) persists the pill's dragged `{x, y, displayId}` as JSON under `%LOCALAPPDATA%/usage-pill/` (same path convention as `activity.jsonl`). `placement.js` saves on drag-end -- piggybacking on the existing move-silence timer used to detect "drag over" on Windows, so writes are naturally debounced to once per drag -- and loads once at launch via `ConfigStore.resolveLaunchBounds()`. A `display-removed` whose display was the pill's own falls back to top-center of the new primary display (the saved `displayId` is now stale, so the next launch would've fallen back anyway); a `display-metrics-changed` for an unrelated display is a no-op, so a hotplug elsewhere never nudges an already-placed pill.

- **`placement.js` (`createPillPlacement`)** owns shared pill placement. It provides `launchBounds` and `attach(win, createPositionMenu)`; attach once per window. It coordinates drag, hover, reset, display recovery, and persistence, and removes its timers and event subscriptions when the window closes. `window.js` supplies Electron screen and menu adapters; tests supply deterministic adapters through the same seam. Restore still clamps the full window, dragging clamps the visible pill, and expansion does not reposition an edge placement. These policies are intentionally preserved by the refactor.

### Two independent activity/usage detection paths

**Claude:**
- Primary signal: `hooks/activity-hook.js` (installed into `~/.claude/settings.json`, see README's "How activity detection works") appends one line per hook event to an append-only `activity.jsonl` under `%LOCALAPPDATA%/usage-pill/`. `parsers/activityLog.js` replays it as a small state machine (`start`/`subagent_start`/`subagent_stop`/`blocked`/`end`/`session_end`) that distinguishes "blocked on a permission prompt" from "tool running" — something a transcript alone can't. Hook changes only apply from the *next* Claude Code session onward.
- Fallback (pre-hook sessions, or hooks disabled): `providers/claudeActivity.js` tails the newest `.jsonl` per project dir under `~/.claude/projects/`, and `parsers/claudeTranscript.js` walks it backward interpreting `stop_reason`/`tool_result`/sidecar-record rules (see the doc comment in that file — it encodes several non-obvious "ground truth verified against real transcripts" facts, e.g. a family of sidecar record types carry no `timestamp` and must be ignored entirely).
- `stores/activity.js`'s `readClaudeState()` picks hook-vs-fallback per read (prefers the hook log whenever it has a real timestamp).

**Codex:** no turn-start hook exists, so both activity *and* usage come from one backward-scan-friendly pass (`providers/codex.js` `readCodexSnapshot()` → `parsers/codexRollout.js`) over today's + yesterday's rollout files under `~/.codex/sessions/YYYY/MM/DD/`.
- **Critical invariant:** a session's `rate_limits` are only trustworthy from its root/user thread (`payload.parent_thread_id == null && thread_source === 'user'`) — a subagent thread's `rate_limits` are a stale/partial snapshot and must never be used for the usage percentage.
- Subagent *activity* still counts, though (a running subagent means Codex is genuinely working). See `test/parsers.test.js`'s "subagent trap" test for why this matters.

**Claude's usage** (separate from its activity) comes from `providers/claude.js`, which reads the OAuth access token fresh from `~/.claude/.credentials.json` on every call and never attempts its own token refresh (that's Claude Code's job — racing it would invalidate the user's session).

### Automatic startup (Windows, macOS, Linux)

`--monitor` mode runs the pill hidden until a `claude`/`codex` session opens, per the terminology in [CONTEXT.md](CONTEXT.md). `index.js` no longer gates this to `win32` — session detection and login-item registration are both cross-platform now (see below).

- **`stores/sessions.js` (`SessionStore`)** polls `providers/processes.js` every second — a platform dispatcher that picks `readWindowsProcesses` (PowerShell/CIM `Win32_Process`, scoped to the interactive desktop session so services and other users' sessions never appear), `readMacProcesses` (`ps -eo pid,ppid,lstart,command`, forced `COLUMNS`/`LC_ALL=C` to avoid truncation/locale issues), or `readLinuxProcesses` (`/proc/<pid>/cmdline`, filtered to `process.getuid()`) by `process.platform`, normalizing each into `{name, pid, parentPid, createdAt, argv}` before classifying it through `parsers/processSessions.js`. A failed poll retains the previous snapshot rather than flashing the pill closed; concurrent polls share one in-flight read via `AbortController`.
- **`parsers/processSessions.js`** decides whether a `claude.exe`/`codex.exe`/`node.exe` row is a real agent session: it parses the raw Windows command line (backslash/quote rules differ from POSIX shells — see `splitCommandLine`), excludes utility commands/options (`--help`, `mcp-server`, etc.) so ordinary CLI use doesn't pop the pill, and collapses a launcher/child pair (e.g. `node.exe` running `codex.js` spawning `codex.exe`) into one session. **Claude Desktop ships its own `claude.exe`** (MSIX under `WindowsApps`, or a per-user `AnthropicClaude` install) that is otherwise indistinguishable from the CLI by name or args — `DESKTOP_APP_PATH_MARKERS` rejects it by install path. Command lines can contain prompts or secrets, so they're never logged or surfaced in errors.
- **`visibility.js`** (`VisibilityController`) is the state machine deciding whether the window should be visible: `ready && !paused && (preview || hasSessions)`. `index.js` wires it to `SessionStore` (`setSessions`), the tray (`pause`/`resume`/`showPreview`), and window show/hide — `driver.start()`/`stop()` (the `Reducer` or `MockDriver`) only run while visible, so there's no background polling cost while hidden.
- **`login.js`** (`configureLogin`) dispatches by platform. On Windows it registers/removes the login item via `app.setLoginItemSettings`; verifying the write is non-obvious there — `app.getLoginItemSettings({path, args}).openAtLogin` resolves identity by the app's AppUserModelID, not the custom `name: 'UsagePill'` passed to `setLoginItemSettings`, so it never reflects this registration, and verification instead reads `getLoginItemSettings().launchItems` and matches by `name`. On macOS and Linux, Electron's `setLoginItemSettings` can't target an arbitrary unpackaged executable+args (macOS's `path`/`args`/`name` options are Windows-only; it can only toggle whether the app's own signed, notarized bundle relaunches itself), so both platforms write their own login-item file directly and read it back to verify: a `~/Library/LaunchAgents` LaunchAgent plist on macOS, an XDG `~/.config/autostart` `.desktop` entry on Linux (`$XDG_CONFIG_HOME/autostart` when set).
- **`index.js`**'s `--setup`/`--remove-startup` branch runs headless (no window/tray) and must report failure through `app.exit(code)`, not `process.exitCode` + `app.quit()` — Electron ignores `process.exitCode` on quit, so `scripts/manage-startup.js` (the `npm run setup`/`setup:remove` entry point, which spawns Electron and reads its real exit code) would otherwise report success on a failed registration.
- **`tray.js`** offers Pause/Resume/Show preview/Show usage details/Quit, reading `VisibilityController.snapshot()` to render its current label/tooltip. Show usage details previews the pill, gives the window real OS focus (unlike the hover-preview path's `showInactive()`), and tells the renderer to focus an agent badge — the keyboard entry point into the expanded-card inspection described below.

### npm packaging

The package installs globally (`npm install -g @mrayyan911/usage-pill`) via `package.json`'s `bin.usage-pill` pointing at `bin/usage-pill.js`, a thin shim (`#!/usr/bin/env node`) that resolves `require('electron')` to the platform Electron binary's path (the standard mechanism for npm-distributed Electron CLIs) and spawns it against the package root. `scripts/cliArgs.js`'s `resolveSubcommandArgs` is the single place mapping CLI subcommands (`setup`, `setup:remove`, `monitor`, or none) to the flags `index.js` parses (`--setup`, `--remove-startup`, `--monitor`) — shared between `bin/usage-pill.js` and `scripts/manage-startup.js` (the `npm run setup`/`setup:remove` entry point for a dev checkout) so the mapping exists in exactly one place. `electron` lives in `dependencies`, not `devDependencies` — a global install needs it physically present. No build step: `npm start` is unaffected.

### Shared low-level helpers

- `fsUtil.js`: `readTail` (reads only the last 64KB of a file — session files only grow, so this avoids re-reading whole transcripts), `statOrNull`, `newestFileIn` (newest file in a dir matching a prefix/suffix, with an authoritative per-file `statSync` rather than trusting `readdir`'s dirent, which can be stale on Windows). Prefer these over ad hoc `fs.readdirSync`/`fs.statSync` scans — see git history for a case where a hand-rolled duplicate of `newestFileIn` silently dropped its `isFile()` guard.
- `usageShape.js`: the shared `EMPTY_USAGE` shape (`{percent, resetsAt, weeklyPercent, planType}` all null) both providers and the usage store spread into their status-specific returns — reuse it rather than hand-copying the literal.

### Renderer (`src/renderer/`, `src/preload.js`)

No framework, no build step. `preload.js` is the *only* bridge between main and renderer (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`), exposing `window.usagePill.onState`/`onHover`/`onInspect`/`setExpanded`. `pill.js` renders `state.agents` (1 or 2 entries) into a collapsed icon strip and an expanded card of one row per agent, using a keyed reconciliation (`reorderByKey`) that reuses a DOM node as long as its agent is still shown -- reordering two still-shown agents moves the existing nodes via `insertBefore` instead of recreating them. This matters because `active` (the order/primary signal from `ActivityStore.poll()`, see below) is only sticky, not fully stable, so a purely position-keyed diff would periodically rebuild both rows and restart their CSS animations (badge pulse, shimmer sweep) while both agents are simultaneously busy. Each agent badge is a button: clicking (or, via the tray's Show usage details entry, keyboard focus) selects that agent's detail line within the existing card bound, with a `← Back` control to return to the two-agent view; Escape or losing window focus closes inspection. `setExpanded` reports the renderer's actual expansion state back to `placement.js` over the `pill:expanded` IPC channel so native drag-clamp bounds follow keyboard-driven expansion, not just pointer hover. Per-row color is a `--row-color` CSS custom property write (`pill.js`, one per `.agent-row`) consumed declaratively by `pill.css` for the bar-fill, with `.bar-fill.amber`/`.red` classes overriding it above threshold via specificity — don't reintroduce imperative `style.backgroundColor` branching here. `icons.js` inlines the real brand marks (mirrored from `assests/claude-code-color.svg` and `assests/codex-dark.svg`, kept in sync by hand) as SVG markup generated with unique paint-server IDs and restrained terracotta/satin-silver material shading, injected via `innerHTML` rather than `<img src>` so the CSP never needs to widen for a repo-root assets folder.

### `window.js` and `placement.js`: Windows-specific Electron gotchas already solved

Several non-obvious platform fixes are baked in and documented inline — don't "simplify" them without reading the comments first: `frame: false` is mandatory for `transparent: true` to work on Windows; `alwaysOnTop` must be reasserted at level `'screen-saver'` (the default `'floating'` sits *below* the taskbar on Windows); the window is sized for its *expanded* state up front since a transparent window can't resize without a visible flash; hover is detected by polling `screen.getCursorScreenPoint()` against `ConfigStore.pillHitRect()` from the main process rather than CSS `:hover` (unreliable across the transparent surface); dragging (native `-webkit-app-region: drag`, scoped in `pill.css` to the icon/bar surface, not the detail line, in either collapsed or expanded state) is live-clamped via `ConfigStore.clampWindowToVisiblePill()` on every `move` event -- clamping the *visible pill*, not the larger pre-sized window, so it hard-stops flush with the screen edge rather than short of it -- and hover state is frozen (not re-tested) for the duration of a drag, so a grab can't trigger a new expand or collapse an already-expanded card out from under the cursor; placement ignores unrelated display changes, re-clamps on its own display's metrics changes, and falls back to top-center of the primary display when its own display is removed.

## Contributing conventions (see `CONTRIBUTING.md` for full detail)

- **Before implementing anything:** check whether local `main` is behind `origin/main` (`git fetch` + `git status -sb` or equivalent) and update it first if so — merge or rebase, resolving any conflicts, before writing any code. Then decide whether the change warrants its own branch (see the rule below) and, if so, create it from the now-current `main` before making any edits. A trivial one-line fix on an already-current `main` doesn't need this ceremony reasserted mid-task — this is about not starting work on stale history or committing multi-file feature work straight to `main`.
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
