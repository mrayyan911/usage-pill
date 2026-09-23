BUG: Usage Pill does not detect an active Codex session on Windows

I have a reproducible issue with agent/session detection.

Observed behavior:
- Codex is actively running in a terminal and processing work.
- Usage Pill remains in the OFFLINE state.
- The pill does not show Codex as the active agent.
- Therefore the UI state does not match the actual running Codex session.

I have attached a screenshot showing both at the same time:
1. Codex actively running in the terminal.
2. Usage Pill displaying OFFLINE.

Expected behavior:
When a real Codex CLI/session is running, Usage Pill should automatically:
- detect the Codex process/session,
- classify it as `codex`,
- switch from OFFLINE to the active state,
- display the Codex avatar/icon,
- display Codex usage if usage information is available,
- return to OFFLINE only after the Codex session actually stops.

Please investigate this end-to-end. Do not apply a cosmetic UI workaround.

Trace the complete pipeline:

Windows processes
    ↓
process discovery
    ↓
candidate process filtering
    ↓
CLI/session identification
    ↓
Claude vs Codex classification
    ↓
session state
    ↓
usage-provider lookup
    ↓
IPC/state update
    ↓
renderer
    ↓
Usage Pill

Specifically investigate:

1. PROCESS DETECTION

Inspect what Windows actually reports while Codex is running.

Check:
- process name
- executable path
- command line
- parent PID
- parent process
- child processes
- terminal host
- PowerShell/cmd involvement
- whether Codex itself is represented by `node.exe`, `codex.exe`, a shell process, or another wrapper

Do not assume the visible terminal process name is the actual process we should classify.

Compare the live process tree against our current detection logic.

2. CODEX CLASSIFICATION

Find the exact code responsible for determining:

`offline`
`claude`
`codex`
or any other session type.

Determine why this running Codex instance fails the classifier.

Check for assumptions such as:
- exact process-name matching
- exact executable-name matching
- command-line matching
- parent-process assumptions
- case-sensitive comparisons
- Windows path normalization problems
- shell/wrapper processes
- CLI installed globally through npm
- Codex running through PowerShell or Windows Terminal

Do not solve this by adding a random one-off string check unless that accurately represents the real Codex process model.

3. SESSION STATE

Verify whether Codex is:

A. never discovered,
B. discovered but filtered out,
C. discovered but classified incorrectly,
D. classified correctly but not stored as an active session,
E. stored correctly but not propagated to the renderer,
F. displayed incorrectly by the renderer.

Add temporary diagnostic logging if necessary so we can see which stage fails.

Useful diagnostic output would look like:

PROCESS FOUND
pid:
name:
executable:
commandLine:
parentPid:
parentName:

CLASSIFICATION
candidate:
detectedAgent:
reason:

SESSION
sessionId:
agent:
active:
lastSeen:

RENDERER STATE
activeAgents:
displayState:

4. USAGE DETECTION

The problem may contain two independent issues:

A. Codex activity detection
B. Codex usage retrieval

Separate them during debugging.

Even if Codex usage cannot currently be obtained, an actively running Codex session MUST NOT be displayed as OFFLINE.

If activity is detected but usage retrieval fails, use the appropriate active/no-usage state instead of treating the session as offline.

5. POLLING / IPC

Verify:
- process polling actually runs while the application is open,
- newly started Codex sessions are discovered without restarting Usage Pill,
- stopping Codex removes the session,
- IPC updates reach the renderer,
- stale previous session data does not override the current detected agent,
- process polling errors are not silently swallowed.

6. MULTIPLE AGENTS

Do not regress the intended behavior when Claude and Codex are both running.

Verify:
- Codex only → Codex active
- Claude only → Claude active
- Claude + Codex → both detected
- neither → OFFLINE

7. REGRESSION TESTS

Add tests reproducing the actual Windows process structure discovered during this investigation.

Do not write tests around an assumed structure first.

Capture the real process information, then build fixtures representing it.

At minimum test:

- Codex running directly
- Codex launched through PowerShell
- Codex running under a terminal host
- Claude running
- Claude + Codex simultaneously
- unrelated Node process
- unrelated PowerShell process
- Codex exits
- Codex starts after Usage Pill is already running

Acceptance criteria:

1. Start Usage Pill with no agents running
   → OFFLINE

2. Start Codex
   → Usage Pill automatically detects Codex without restarting the app

3. Codex continues running
   → pill remains active and identifies Codex

4. Stop Codex
   → Codex session disappears and pill returns to OFFLINE if nothing else is active

5. Start Claude
   → Claude is detected

6. Start Claude + Codex
   → both are represented according to the existing multi-agent UI behavior

7. Existing Claude detection must remain working.

8. No unrelated Node/PowerShell/terminal process should cause a false positive.

Before changing code:
- reproduce the bug,
- capture the real Windows process tree for the running Codex session,
- identify the exact failing stage,
- explain the root cause.

Then implement the smallest robust fix.

After implementation:
- run relevant unit/integration tests,
- manually verify against a real running Codex session,
- report the root cause,
- list modified files,
- explain how detection now works,
- provide the test evidence.

Do not modify unrelated functionality.
Do not hide detection failures by simply changing OFFLINE UI behavior.