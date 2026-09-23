# Usage Pill

A tiny always-on-top overlay showing real-time Claude Code / Codex usage: an
animated bar, a percentage, and an agent badge per active agent — one row
normally, two stacked when Claude and Codex are both mid-turn at once.

Launches top-center of your primary display, Dynamic-Island style — hover
to expand it in place and see reset time / weekly usage / plan. Drag it
anywhere on any connected display, collapsed or expanded; it hard-stops at
the edge of whichever display it's currently over, and reopens at that same
spot next launch (falling back to top-center if that display's gone).

Click an agent icon to inspect its activity, reset time, weekly usage, and
plan. When two agents are shown, **← Both** returns to the two-row view.
A small **!** marks an agent waiting for approval. Stale readings retain
their last percentage with a separate freshness label.

For keyboard access, choose **Show usage details** from the tray, then use
Tab and Enter to inspect an agent. Press Escape or focus another window to
close the details. Drag using the bar area; the expanded icons are buttons.

## Install

```
npm install -g @mrayyan911/usage-pill
usage-pill              # real data, always visible (manual preview)
usage-pill setup        # register a hidden monitor to launch at login
usage-pill monitor      # run that monitor manually, without registering it
usage-pill setup:remove # unregister it
```

## Run it from source

```
npm install
npm start                    # real data, always visible (manual preview)
USAGE_PILL_MOCK=1 npm start  # scripted demo of every state, no waiting on real usage
USAGE_PILL_DEBUG=1 npm start # also logs every state change to the terminal
```

## Automatic startup (Windows, macOS, Linux)

Instead of running `npm start` yourself every time, Usage Pill can run as a
hidden background monitor that appears only while a `claude` or `codex`
session is open — one shared pill across every open terminal — and
disappears when the last one closes.

```
npm run setup         # register a hidden monitor to launch at login
npm run monitor        # run that monitor manually, without registering it
npm run setup:remove   # unregister it
```

A tray icon offers **Pause automatic display**, **Resume**, **Show preview**,
**Show usage details**, and **Quit**. Scripted runs (`codex exec`, `claude -p`) count as sessions;
`--help`/`--version`/utility subcommands and Claude Desktop do not.

`npm run setup`/`npm run setup:remove` register/unregister a login item on
Windows, macOS (a `~/Library/LaunchAgents` LaunchAgent), and Linux (an XDG
`~/.config/autostart` entry), then launch the background monitor — the part
that watches for an open `claude`/`codex` session and shows/hides the pill —
which now runs cross-platform too. The macOS/Linux paths are verified against
current Electron/XDG documentation and covered by unit tests, but haven't
yet been exercised on real macOS/Linux hardware.

## Test

```
npm test
```

149 unit tests cover the parsers (against scrubbed captured payload fixtures),
the activity-log state machine, launch-position/drag-clamp/hover hit-test
bounds math, saved-position load/save round-tripping, the activity store's
sticky dual-agent selection and busy-agent handoff preference, the reducer
(including the two-agents-busy-at-once case), Windows/macOS/Linux session
detection/classification, the cross-platform login-item registration
(Windows/macOS/Linux), cross-platform automatic monitor mode, the CLI
subcommand→flag mapping shared by `bin/usage-pill.js` and
`scripts/manage-startup.js`, and the automatic-visibility/login/tray wiring.
No Electron runtime needed to run these — they're pure functions.

## How activity detection works

Claude Code's own hooks are the primary signal (see the `hooks` block added
to `~/.claude/settings.json` and `hooks/activity-hook.js`, which they invoke).
They distinguish "blocked on a permission prompt" from "tool running", which
a transcript alone cannot. **These apply from your next Claude Code session
onward** — a running session doesn't pick up settings.json hook changes
until it restarts. Until then, and as a permanent fallback if hooks are ever
disabled, the app tails the session transcript directly.

Codex has no equivalent turn-start hook, so its activity comes entirely from
tailing the newest rollout file, which already gets scanned for usage.

## What was verified before building

- Both HTTP/local data sources were read live (not just documented) before any
  code was written: Claude's `/api/oauth/usage`, Codex's rollout `rate_limits`.
- A background technical review verified real file schemas (Claude transcript
  record types, Codex rollout event types, the Codex hooks.json/config.toml
  trust-hash gating) and current Electron docs for the Windows-specific
  transparency/always-on-top/drag gotchas baked into `src/main/window.js`.
- This build was smoke-tested end-to-end: mock mode (every state/threshold),
  and real mode (confirmed live Claude usage — 51%/69% — and correct
  `working` activity detection during this very session).

## Not done yet

- **Publishing.** The `@mrayyan911/usage-pill` package isn't published to the
  npm registry yet — `npm install -g` won't work until `npm publish
  --access public` has been run once from a maintainer's authenticated npm
  session.
- **Live full end-to-end UI check** (does the pill actually look right on
  your screen — hover-expand, fullscreen-app stacking, monitor unplug).
  Everything underneath was verified programmatically; only run `npm start`
  yourself to confirm the last mile.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
