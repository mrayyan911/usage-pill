'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TAIL_BYTES = 64 * 1024;

/**
 * Reads only the last TAIL_BYTES of a file and returns it as utf8 text,
 * discarding the first (possibly truncated) line fragment. Callers'
 * parsers tolerate a JSON.parse failure on any remaining truncated line,
 * so this is a cheap, safe way to avoid re-reading whole session files
 * that only grow.
 */
function readTail(filePath, maxBytes = TAIL_BYTES) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - maxBytes);
    const length = size - start;
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, start);
    const text = buffer.toString('utf8');
    if (start === 0) return text;
    // Drop the first fragment: it may start mid-line.
    const firstNewline = text.indexOf('\n');
    return firstNewline === -1 ? '' : text.slice(firstNewline + 1);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Authoritative stat: always resolve the explicit file path with statSync
 * rather than deriving mtime from a readdir listing, which can serve a
 * stale cached directory entry on Windows.
 */
function statOrNull(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

/**
 * Returns the most-recently-modified file matching `pattern` (a simple
 * glob: a directory plus a filename prefix/suffix, no wildcards mid-path)
 * under `dir`, or null. Used to find "today's" and "yesterday's" rollout
 * files, and each project's newest transcript, without pulling in a full
 * glob dependency for a handful of known shapes.
 */
function newestFileIn(dir, { prefix = '', suffix = '.jsonl' } = {}) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  let best = null;
  let bestMtime = -Infinity;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (prefix && !entry.name.startsWith(prefix)) continue;
    if (suffix && !entry.name.endsWith(suffix)) continue;
    const full = path.join(dir, entry.name);
    // Authoritative stat on the resolved path -- readdir's dirent does not
    // carry a trustworthy mtime on Windows.
    const stat = statOrNull(full);
    if (!stat) continue;
    if (stat.mtimeMs > bestMtime) {
      bestMtime = stat.mtimeMs;
      best = full;
    }
  }
  return best;
}

module.exports = { readTail, statOrNull, newestFileIn, TAIL_BYTES };
