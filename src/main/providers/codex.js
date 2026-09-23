'use strict';

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const { statOrNull } = require('../fsUtil');
const { parseCodexRollout } = require('../parsers/codexRollout');
const { EMPTY_USAGE } = require('../usageShape');

const SESSIONS_ROOT = path.join(os.homedir(), '.codex', 'sessions');
const rolloutCache = new Map();

// Tail slices lose session_meta and long-running turns' start events. Keep
// only the records needed by the parser, reading appended bytes on later polls.

// A same-path rewrite (truncate + overwrite) can keep the OS's birthtime, mtime,
// and inode identical to the previous file -- verified empirically, not just in
// theory -- so file metadata can't detect it. The opening session_meta line
// uniquely identifies a session; compare that instead of trusting fs stats alone.
function readFirstLine(fd, size) {
  if (!size) return '';
  const len = Math.min(size, 8192);
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, 0);
  const nl = buf.indexOf(10);
  return buf.toString('utf8', 0, nl === -1 ? len : nl);
}

function readRollout(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const stat = fs.fstatSync(fd);
    const firstLine = readFirstLine(fd, stat.size);
    let cached = rolloutCache.get(filePath);
    if (!cached || cached.firstLine !== firstLine || stat.size < cached.offset) {
      cached = { firstLine, offset: 0, pending: Buffer.alloc(0), meta: null, turn: null, usage: null };
    }
    const buffer = Buffer.alloc(64 * 1024);
    while (cached.offset < stat.size) {
      const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, stat.size - cached.offset), cached.offset);
      if (!count) break;
      cached.offset += count;
      const data = Buffer.concat([cached.pending, buffer.subarray(0, count)]);
      let start = 0, end;
      while ((end = data.indexOf(10, start)) !== -1) {
        let record;
        try { record = JSON.parse(data.toString('utf8', start, end)); } catch {}
        start = end + 1;
        if (record?.type === 'session_meta' && !cached.meta) {
          cached.meta = { type: 'session_meta', payload: {
            parent_thread_id: record.payload?.parent_thread_id,
            thread_source: record.payload?.thread_source,
          }};
        } else if (record?.type === 'event_msg') {
          const p = record.payload;
          if (p?.turn_id && ['task_started', 'task_complete'].includes(p.type)) {
            cached.turn = { type: 'event_msg', payload: { type: p.type, turn_id: p.turn_id } };
          } else if (p?.type === 'token_count' && p.rate_limits) {
            cached.usage = { type: 'event_msg', payload: { type: p.type, rate_limits: p.rate_limits } };
          }
        }
      }
      cached.pending = Buffer.from(data.subarray(start));
    }
    rolloutCache.set(filePath, cached);
    const parsed = parseCodexRollout([cached.meta, cached.turn, cached.usage].filter(Boolean).map(r => JSON.stringify(r)).join('\n'));
    if (cached.turn?.payload.type === 'task_complete') parsed.activity = 'idle';
    return parsed;
  } finally { fs.closeSync(fd); }
}

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

/**
 * Incrementally scans today's and yesterday's rollout files, newest-first,
 * retaining thread identity, latest turn boundary, and latest usage.
 *
 * - Usage comes from the first user/root-thread file that carries
 *   rate_limits (subagent files are skipped for this purpose -- their
 *   rate_limits are stale/partial snapshots).
 * - The newest root's activity wins over completed subagents. A newer busy
 *   subagent still counts as working. Older abandoned threads cannot keep a
 *   completed root busy. The newest file mtime remains the freshness signal.
 *
 * @returns {{
 *   usage: {percent:number|null, resetsAt:Date|null, weeklyPercent:number|null, planType:string|null, status:'ok'|'error'},
 *   activity: 'working'|'idle'|'unknown',
 *   newestMtimeMs: number|null
 * }}
 */
function readCodexSnapshot({ files: candidates = allRolloutFilesToday() } = {}) {
  const present = new Set(candidates);
  for (const file of rolloutCache.keys()) if (!present.has(file)) rolloutCache.delete(file);
  const files = candidates
    .map((filePath) => ({ filePath, mtimeMs: statOrNull(filePath)?.mtimeMs ?? null }))
    .filter((f) => f.mtimeMs != null)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  let usage = { ...EMPTY_USAGE, status: 'error' };
  let activity = 'unknown';
  let newestMtimeMs = files.length > 0 ? files[0].mtimeMs : null;
  let usageFound = false;
  let activityFound = false;

  for (const { filePath } of files) {
    let parsed;
    try {
      parsed = readRollout(filePath);
    } catch {
      continue;
    }
    const { isUserThread, rateLimits, activity: fileActivity } = parsed;

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

    if (!activityFound) {
      if (fileActivity === 'working' || (activity === 'unknown' && fileActivity !== 'unknown')) activity = fileActivity;
      if (isUserThread && fileActivity !== 'unknown') activityFound = true;
    }

    if (usageFound && activityFound) break;
  }

  return { usage, activity, newestMtimeMs, hasFiles: files.length > 0 };
}

module.exports = { readCodexSnapshot, candidateRolloutDirs, allRolloutFilesToday };
