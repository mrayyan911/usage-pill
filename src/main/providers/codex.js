'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { readTail } = require('../fsUtil');
const { parseCodexRollout } = require('../parsers/codexRollout');

const SESSIONS_ROOT = path.join(os.homedir(), '.codex', 'sessions');

/**
 * Codex rollout files live at ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl.
 * Candidates span today and yesterday (a session started before midnight
 * keeps writing to yesterday's file).
 */
function candidateRolloutDirs() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const dirFor = (d) =>
    path.join(
      SESSIONS_ROOT,
      String(d.getFullYear()),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0')
    );
  return [dirFor(now), dirFor(yesterday)];
}

function allRolloutFilesToday() {
  const files = [];
  for (const dir of candidateRolloutDirs()) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
        files.push(path.join(dir, name));
      }
    }
  }
  return files;
}

function statMtime(filePath) {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Single backward-scan-friendly pass over all of today's (+ yesterday's)
 * rollout files, newest-first, yielding BOTH usage and activity from one
 * set of tail reads rather than two independent scans.
 *
 * - Usage comes from the first user/root-thread file that carries
 *   rate_limits (subagent files are skipped for this purpose -- their
 *   rate_limits are stale/partial snapshots).
 * - Activity is the first non-"unknown" reading across ALL files
 *   (including subagents -- a running subagent means Codex is working),
 *   and its mtime is the newest mtime seen across every file scanned so
 *   activity's own "most recently touched" comparison stays honest even
 *   though the answer may come from a different file than the newest one.
 *
 * @returns {{
 *   usage: {percent:number|null, resetsAt:Date|null, weeklyPercent:number|null, planType:string|null, status:'ok'|'error'},
 *   activity: 'working'|'idle'|'unknown',
 *   newestMtimeMs: number|null
 * }}
 */
function readCodexSnapshot() {
  const files = allRolloutFilesToday()
    .map((filePath) => ({ filePath, mtimeMs: statMtime(filePath) }))
    .filter((f) => f.mtimeMs != null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  let usage = { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' };
  let activity = 'unknown';
  let newestMtimeMs = files.length > 0 ? files[0].mtimeMs : null;
  let usageFound = false;

  for (const { filePath } of files) {
    let text;
    try {
      text = readTail(filePath);
    } catch {
      continue;
    }
    const { isUserThread, rateLimits, activity: fileActivity } = parseCodexRollout(text);

    if (!usageFound && isUserThread && rateLimits) {
      const primary = rateLimits.primary || {};
      const secondary = rateLimits.secondary || {};
      usage = {
        percent: typeof primary.used_percent === 'number' ? primary.used_percent : null,
        resetsAt: primary.resets_at ? new Date(primary.resets_at * 1000) : null,
        weeklyPercent: typeof secondary.used_percent === 'number' ? secondary.used_percent : null,
        planType: rateLimits.plan_type || null,
        status: 'ok',
      };
      usageFound = true;
    }

    if (activity === 'unknown' && fileActivity !== 'unknown') {
      activity = fileActivity;
    }

    if (usageFound && activity !== 'unknown') break; // both answers in hand
  }

  return { usage, activity, newestMtimeMs, hasFiles: files.length > 0 };
}

module.exports = { readCodexSnapshot, candidateRolloutDirs, allRolloutFilesToday };
