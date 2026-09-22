# Usage Pill

A tiny always-on-top overlay showing real-time Claude Code / Codex usage: an
animated bar, a percentage, and an agent badge per active agent — one row
normally, two stacked when Claude and Codex are both mid-turn at once.

Fixed at the top-center of your primary display, Dynamic-Island style — hover
to expand it in place and see reset time / weekly usage / plan.

## Run it

```
npm install
npm start                    # real data
USAGE_PILL_MOCK=1 npm start  # scripted demo of every state, no waiting on real usage
USAGE_PILL_DEBUG=1 npm start # also logs every state change to the terminal
```

## Test

```
npm test
```

41 unit tests cover the parsers (against real captured payload fixtures),
the activity-log state machine, fixed-position bounds and hover hit-test
math, the activity store's sticky dual-agent selection and busy-agent
handoff preference, and the reducer (including the two-agents-busy-at-once
case). No Electron
runtime needed to run these — they're pure functions.

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

- **Packaging.** `npm start` runs from source. Packaging (e.g. `electron-builder`)
  and the launch-on-login wiring in `src/main/index.js` (already gated on
  `app.isPackaged`) are ready for it but untested, since there's nothing to
  package into yet.
- **Live full end-to-end UI check** (does the pill actually look right on
  your screen — hover-expand, fullscreen-app stacking, monitor unplug).
  Everything underneath was verified programmatically; only run `npm start`
  yourself to confirm the last mile.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT — see [LICENSE](./LICENSE).
