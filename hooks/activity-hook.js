#!/usr/bin/env node
'use strict';

/**
 * Invoked by Claude Code hooks (see the SETUP section of README.md for the
 * exact ~/.claude/settings.json entries). Appends one line to the
 * append-only activity log the running pill app tails for its primary
 * ("hook") activity signal.
 *
 * Usage: node activity-hook.js <ev>
 *   <ev> is one of: start | end | blocked | subagent_start | subagent_stop | session_end
 *
 * Reads the hook's JSON payload from stdin (Claude Code hooks receive
 * session_id, hook_event_name, transcript_path, etc. on stdin) purely to
 * pull session_id for the log line -- never to decide `ev`, which is fixed
 * per hook registration so this script has zero branching logic to get
 * wrong. Must never throw and must never block Claude Code: every failure
 * mode here is swallowed and the process exits 0 regardless.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function activityLogPath() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir();
  return path.join(base, 'usage-pill', 'activity.jsonl');
}

function readSessionIdFromStdin() {
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (!raw) return null;
    const payload = JSON.parse(raw);
    return payload.session_id || null;
  } catch {
    return null;
  }
}

function main() {
  const ev = process.argv[2];
  if (!ev) return;

  const sessionId = readSessionIdFromStdin();
  const line =
    JSON.stringify({
      agent: 'claude',
      ev,
      ts: new Date().toISOString(),
      session_id: sessionId,
    }) + '\n';

  const logPath = activityLogPath();
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, line);
}

try {
  main();
} catch {
  // Never let a logging failure surface to Claude Code.
}
process.exit(0);
