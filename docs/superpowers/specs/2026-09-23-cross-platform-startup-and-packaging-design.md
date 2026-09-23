# Cross-platform automatic startup + npm packaging

Status: approved design, pre-implementation
Date: 2026-09-23

## Context

Automatic-startup (background monitor, tray, login-item registration, native
process detection) currently only works on native Windows — `login.js` and
`scripts/manage-startup.js` both hard-throw off `win32`, and
`providers/windowsProcesses.js` shells out to PowerShell/`Win32_Process`
(CIM), which has no equivalent on other platforms. There is also no packaged
distribution at all: `npm start` and `npm run setup` both run from a git
checkout.

This spec covers three independent pieces of work. They are written up
separately, each scoped to its own files, so they can be implemented,
reviewed, and merged as three separate branches/PRs without one needing the
others loaded in context. Sub-design 3 (packaging) does depend on sub-designs
1 and 2 being real (there's nothing to package a global-install path around
otherwise) — implement in order 1, 2, 3.

Out of scope: WSL support, native OS installers (`.dmg`/`.deb`/`.exe`), code
signing/notarization, auto-update. The distribution model is a plain npm
global install (`npm install -g @mrayyan911/usage-pill`), which is
deliberately *not* the `electron-builder`/`electron-forge` path — no new
build step for development, `npm start` is unaffected.

---

## Sub-design 1: Cross-platform session detection

### Problem

`SessionStore` (`stores/sessions.js`) needs to know whether a `claude`/`codex`
process is running anywhere on the machine, for the current desktop user,
so `--monitor` mode can show/hide the pill. Today this only works via
Windows' CIM `Win32_Process` query. macOS and Linux need their own process
enumeration, but should feed the exact same classification logic
(`parsers/processSessions.js`) that already handles utility-command
exclusion, `--help`/`-p`-style value-skipping, and desktop-app exclusion.

### Design

**New files:**
- `src/main/providers/macProcesses.js`
- `src/main/providers/linuxProcesses.js`
- `src/main/providers/processes.js` — platform dispatcher exporting a single
  `readProcesses({signal})` that picks `readWindowsProcesses` /
  `readMacProcesses` / `readLinuxProcesses` by `process.platform`.

**Normalized row shape**, produced by all three providers (replacing the
Windows-only `{Name, ProcessId, ParentProcessId, CommandLine, CreationDate}`
that `readSessions`/`classifyProcess` currently consume):

```
{ name: string, pid: number, parentPid: number, createdAt: string (ISO), argv: string[] }
```

`classifyProcess` changes to take `argv` directly instead of a raw
`CommandLine` string. `splitCommandLine` (Windows backslash/quote handling)
moves fully inside `windowsProcesses.js`, which calls it before producing the
normalized row — `processSessions.js` no longer does any OS-specific string
splitting itself. `UTILITY_COMMANDS`, `VALUE_OPTIONS`, and the first-word
skip loop are already OS-agnostic once given a real argv array and don't
change.

**Executable-name matching**: replace the hardcoded
`['claude.exe', 'codex.exe', 'node.exe']` check with a per-platform map:

```js
const AGENT_EXE_NAMES = process.platform === 'win32'
  ? { 'claude.exe': 'claude', 'codex.exe': 'codex', 'node.exe': null }
  : { claude: 'claude', codex: 'codex', node: null };
```

(`null` marks "ambiguous, resolve via script-path sniffing" — same as
today's `node.exe` handling.)

**Linux provider** (`linuxProcesses.js`):
- Enumerate `/proc/<pid>/` (numeric directory names only).
- Read `/proc/<pid>/cmdline`: NUL-separated, exact argv — no reconstruction
  ambiguity, unlike Windows or macOS.
- Filter to `process.getuid()` so other logged-in users on a shared machine
  don't leak into the snapshot (this is the Linux equivalent of Windows'
  `SessionId=$desktopSession` filter).
- `createdAt`: read field 22 (`starttime`, in clock ticks since boot) from
  `/proc/<pid>/stat`, convert via `/proc/uptime` and `process.hrtime`-style
  arithmetic to an ISO timestamp. A process that exits between the `readdir`
  and the `stat`/`cmdline` read throws `ENOENT` — catch per-process and skip
  that row rather than failing the whole snapshot (processes appearing and
  disappearing between the directory listing and the per-pid reads is
  normal, not an error condition).
- `parentPid`: field 4 of the same `/proc/<pid>/stat` line.

**macOS provider** (`macProcesses.js`):
- No `/proc` on Darwin. Shell out to
  `ps -eo pid,ppid,lstart,command -U <uid>` where `<uid>` is
  `process.getuid()`.
- Force `COLUMNS` very high (e.g. `'10000'`) in the child's `env` — macOS's
  `ps` truncates the `command` column to terminal width even when the
  output isn't a TTY, silently corrupting long command lines.
- Force `LC_ALL=C` in the child's `env` — `lstart`'s weekday/month names are
  locale-dependent and otherwise unparseable without knowing the user's
  locale.
- Parse each line's fixed-width `lstart` (`Www Mmm dd hh:mm:ss yyyy`) into an
  ISO timestamp.
- `argv` is derived by re-splitting the merged `command` column on
  whitespace. **Known limitation, accepted**: `ps` merges argv into one
  string and does not preserve original quoting, so a value like
  `-p "hello world"` becomes two separate tokens after re-splitting. Because
  `VALUE_OPTIONS` only skips exactly one token after a flag, the second half
  of a multi-word quoted value could in rare cases be misread as a bare
  first-word argument. This mirrors the existing accepted-risk framing
  already used for Windows' quote-handling comment in
  `processSessions.js` — document it the same way, don't attempt a real fix
  (there is no `/proc/<pid>/cmdline` equivalent on macOS without a native
  module or private `KERN_PROCARGS2` sysctl work, which is out of scope).

**Desktop-app exclusion**: extend `DESKTOP_APP_PATH_MARKERS` (or split it
per-platform, matching the `AGENT_EXE_NAMES` shape) with macOS/Linux Claude
Desktop install-path markers. **Before merging**, verify the actual install
path against a real Claude Desktop install on at least macOS (the Windows
marker in production today — `WindowsApps`/`AnthropicClaude` — was verified
against a real machine that had the misclassification bug; ship the same
rigor here rather than a guessed path). If Claude Desktop isn't available on
Linux, skip the Linux marker rather than guessing one; an empty marker list
for that OS is safe (never over-excludes).

### Testing

Same pattern as today's Windows coverage in `test/parsers.test.js`: add
scrubbed synthetic fixtures to `test/fixtures/` —
- a macOS `ps` output sample (multiple rows: real CLI session, utility
  command, desktop app, `node` running the CLI's JS entrypoint)
- a Linux `/proc/<pid>/cmdline`-shaped byte sequence sample (NUL-separated)

covering: real session accepted, utility command excluded, `--help`/`-p`
handled, desktop app excluded, `node` script-path sniffing, and the
parent/child collapse rule (`readSessions`' existing dedup-by-parentPid
logic) — this last one is platform-agnostic and already tested against
Windows fixtures, so the new fixtures mainly need to confirm the same logic
still fires correctly once fed through the new argv-based path.

---

## Sub-design 2: Cross-platform login-item registration

### Problem

`login.js`'s `configureLogin` throws unless `platform === 'win32'`. Need
equivalent register/verify/remove behavior for macOS and Linux, keeping the
existing "write, then read back and verify" pattern (already exercised by
the Windows path's `launchItems`-based verification, added after the PR #10
review found the naive `openAtLogin` check unreliable on Windows).

### Design

`configureLogin(app, enabled, executable, platform)` keeps its existing
signature — it's already platform-injectable for tests, from the PR #10
review fix — and dispatches three ways instead of throwing:

**macOS**: call `app.setLoginItemSettings` the same way Windows does today
(`{name: 'UsagePill', path: executable, args, openAtLogin: enabled, enabled}`).
Verification needs one implementation-time check: confirm against current
Electron docs whether macOS's `getLoginItemSettings().openAtLogin` reflects
this registration reliably (the identity bug that forced Windows onto
`launchItems`-based verification was specifically about Windows resolving
identity via `AppUserModelID`, not about `openAtLogin` in general) — use the
simpler `openAtLogin` check if it's reliable there, otherwise reuse the same
`launchItems`-name-matching approach as Windows. Don't guess; verify against
docs (and ideally a real macOS run) before deciding which.

**Linux**: no Electron API exists for this at all — Electron's
`setLoginItemSettings` is Windows/macOS only. Write an XDG Autostart file
directly:

- Path: `$XDG_CONFIG_HOME/autostart/usage-pill.desktop`, falling back to
  `~/.config/autostart/usage-pill.desktop` when `XDG_CONFIG_HOME` is unset
  (per the XDG Base Directory spec).
- Contents on register:
  ```ini
  [Desktop Entry]
  Type=Application
  Name=Usage Pill
  Exec=<executable> --monitor
  X-GNOME-Autostart-enabled=true
  Hidden=false
  ```
  (`Exec` needs the same args the Windows/macOS `args` array carries —
  `--monitor`, plus the app-path argument in the unpackaged case, same as
  today's branch on `app.isPackaged`.)
- On remove: delete the file if it exists (missing file on remove is not an
  error — treat as already-removed, not a failure).
- Verification: read the file back, confirm it exists (register) or doesn't
  (remove), and that `Exec` matches the expected command. This is the Linux
  equivalent of Windows' `launchItems` readback and macOS's
  `getLoginItemSettings` readback — every platform verifies by reading back
  what was actually persisted, never just trusting the write call succeeded.
- `X-GNOME-Autostart-enabled=true`/`Hidden=false` are included because some
  desktop environments (not just GNOME) honor this key as a soft
  enable/disable flag distinct from the file's mere existence — matches
  standard XDG autostart tooling conventions rather than inventing a new
  toggle scheme.

### Testing

Extend `test/login.test.js`'s existing injectable-`platform` pattern with an
injectable `fs` (or a directory-scoped `homedir`) for the Linux path, so no
test touches a real home directory. Cover: register + verify, remove +
verify, remove-when-never-registered (no-op, no throw), and — mirroring the
Windows identity-mismatch test added in the PR #10 review — a case where a
stale `.desktop` file with a different `Exec` path exists and gets
overwritten/corrected on re-register.

---

## Sub-design 3: npm packaging & distribution

### Problem

There's no way to install Usage Pill other than cloning the repo. Need a
global npm package that gives a `usage-pill` command, without introducing a
build step to the development workflow (`npm start` must keep working
exactly as it does today, per this repo's "no build step" principle).

### Design

**Depends on sub-designs 1 and 2 being implemented** — packaging a
Windows-only monitor wouldn't be a meaningfully different deliverable from
today.

- `package.json` changes:
  - `"name": "@mrayyan911/usage-pill"` (scoped — the unscoped `usage-pill`
    name is already taken on the npm registry by an unrelated package, confirmed
    2026-09-23).
  - `"bin": { "usage-pill": "./bin/usage-pill.js" }`
  - Move `"electron"` from `devDependencies` to `dependencies` — a global
    install needs Electron physically present; npm/Electron's own postinstall
    fetches the correct platform binary automatically, same as it does today
    for local development installs.
- **New `bin/usage-pill.js`**: a thin Node shim (has a `#!/usr/bin/env node`
  shebang). `require('electron')` when executed under plain Node (not the
  Electron runtime) resolves to the path of the Electron binary as a string
  — this is the standard mechanism npm-distributed Electron CLIs use, not a
  runtime API call. The shim spawns that binary against the package root,
  translating subcommands into the same flags `index.js` already parses:
  - `usage-pill` (no args) → foreground, same as today's `npm start`
  - `usage-pill setup` → `--setup`
  - `usage-pill setup:remove` → `--remove-startup`
  - `usage-pill monitor` → `--monitor`

  Extract the subcommand→argv translation into one small pure function
  shared between `bin/usage-pill.js` and `scripts/manage-startup.js`, so the
  mapping exists in exactly one place rather than being duplicated across
  the dev-checkout entrypoint and the globally-installed entrypoint.
- **No change needed** in `login.js`'s existing `app.isPackaged` branch.
  `npm install -g` never runs through `electron-builder`, so
  `app.isPackaged` is `false` in a global install exactly as it is in a dev
  checkout today — both take the existing "unpackaged" branch
  (`args: [app.getAppPath(), '--monitor']`), and `app.getAppPath()` already
  resolves correctly regardless of whether that path is inside a git
  checkout or inside a global `node_modules` install directory.
- **Explicitly out of scope for this sub-design** (mechanical, not
  architectural, and doesn't need a design): the actual one-time
  `npm publish --access public` step, and updating `README.md`/
  `CONTRIBUTING.md` with install/release instructions. Flagged here so the
  implementation plan includes them as plain checklist items rather than
  silently dropping them.

### Testing

Unit-test the extracted subcommand→argv pure function directly (no
Electron spawn needed) — covers all four subcommands plus an unrecognized
subcommand producing a clear error rather than silently doing nothing.
Actually invoking `npm install -g` and confirming the global command works
is a manual verification step for the implementer, not something the
automated suite can cover.

---

## Cross-cutting notes

- All three sub-designs preserve the existing "write, then read back to
  verify" discipline already established by the Windows login-item fix from
  PR #10 — no new sub-design trusts an OS call's return value as proof the
  registration actually took effect.
- Command lines can contain prompts or secrets on every platform, not just
  Windows — the existing "never log or surface `CommandLine`/`argv` in
  errors" rule in `windowsProcesses.js` and `processSessions.js` applies
  identically to the new macOS/Linux providers; carry the comment forward,
  don't silently drop it because it says "Windows" today.
- Implementation order: sub-design 1 → sub-design 2 → sub-design 3 (each
  builds on the last; 3 has a hard dependency on 1 and 2 being real). 1 and
  2 are independent of each other and could be built in either order or in
  parallel if desired, but neither should be split further — each is
  already scoped to one branch/PR per this repo's "one logical change per
  branch" convention.
