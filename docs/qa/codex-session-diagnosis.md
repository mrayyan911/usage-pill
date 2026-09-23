# Codex session diagnosis

Verified on Windows on 2026-09-23, branch `fix/codex-session-offline`.

## Observed failure

Windows reported a PowerShell parent, an npm `node.exe` launcher with the
`@openai/codex/bin/codex.js` script, and its native `codex.exe` child. The
processes shared desktop session 4. The native binary lived under npm's
`@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin` directory.
The shell was hosted through a terminal multiplexer with OpenConsole.
Windows Terminal was also present. Neither terminal nor shell needs agent
classification. The fixture preserves the launcher/child and mixed path
separator structure, with synthetic paths, process IDs, and dates.

The actual process provider and SessionStore returned
`{"agents":["codex"],"status":"ok"}`. The reducer selected Codex and IPC
delivered its row to the renderer. The renderer displayed the Codex icon
and the word `offline`. Classification and session storage were working.

## Confirmed causes

1. The provider read only the final 64 KB of each rollout. The live root file
   was roughly 825 KB. Its tail contained rate limits but lacked session_meta,
   so the root-only trust check rejected valid usage. The complete header
   identified a user thread; the full file contained valid usage.
2. A turn start can also fall outside that tail. A newer completed guardian
   rollout supplied idle activity before the provider reached the working root.
3. The renderer translated a usage retrieval error into `offline`, conflating
   unavailable usage with absence of an agent session.

## Fix

The provider scans a rollout once, then reads appended bytes. It retains only
thread identity, the latest turn boundary, usage, and any unfinished line.
Subagent usage remains untrusted. A completed guardian does not mask a working
root; an older abandoned subagent does not override a newer completed root.
Missing usage displays `unavailable`, preserving the agent icon and activity.
Process query failures produce a sanitized warning once per failure transition;
debug mode includes session snapshots without command lines.

No process classification rule was broadened. Automatic visibility still hides
the pill after the last session exits; manual preview keeps its neutral state.

## Evidence

Before the fix, `node_modules/.bin/electron.cmd test/codex-session.cjs --live`
failed the renderer assertion with `agent: codex, text: offline`. The initial
script used live mode by default; the final script makes it explicit and uses
the scrubbed process fixture by default. Repeating the failure gave the same result.

`node --test test/codex-provider.test.js` failed with `null !== 10` against a
synthetic root rollout whose metadata and turn start precede 100 KB of content.
The same test passes after the provider fix and covers completion, partial
appends, and file truncation/replacement.

- `npm.cmd test`: 101 passed, zero failed.
- `npm.cmd run test:renderer`: two passed, zero failed.
- Live process/provider check: Codex detected, working, usage status `ok`.
- Live renderer check: Codex icon and 29% usage, weekly 5%, plus plan.
- Captured and visually inspected the real renderer output through the preload
  and IPC path. Started the application with `npm.cmd start`.
- Measured local scan: about 10 ms initially, 2 ms cached.
- `git diff --check`: clean. No temporary debug instrumentation remains.

Fixture tests cover direct Codex, PowerShell/npm launch, terminal-host siblings,
unrelated Node/shell processes, Claude alone, both agents, starts after an empty
poll, exits, missing usage, and stale activity. Live start/exit of the debugging
Codex session and a live Claude CLI session were not exercised.

## Changed files

- `src/main/providers/codex.js`: incremental rollout reading and activity selection.
- `src/main/index.js`: sanitized session failure reporting and debug snapshots.
- `src/renderer/pill.js`: accurate missing-usage label.
- `package.json`: register provider and Electron regression tests.
- `test/codex-provider.test.js`: large rollout, append, replacement, activity tests.
- `test/codex-session.cjs`, `test/codex-session.test.js`: process-to-renderer check.
- `test/fixtures/codex-windows-processes.json`: scrubbed observed process structure.
- `test/parsers.test.js`, `test/sessions.test.js`: classification and lifecycle coverage.

Suggested commit: `fix: preserve Codex rollout identity beyond the tail window`.
