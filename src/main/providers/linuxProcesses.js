'use strict';

const fs = require('node:fs/promises');

// Linux's USER_HZ (clock ticks/sec used by /proc/<pid>/stat's starttime
// field) is 100 on effectively every real-world x86/x86_64/arm kernel;
// hardcoded rather than shelling out to `getconf CLK_TCK` for a value that
// essentially never differs in practice.
const CLOCK_TICKS_PER_SEC = 100;

// /proc/<pid>/cmdline is NUL-separated argv, ending in a trailing NUL. Only
// the one trailing separator is dropped, not every empty run, so a
// legitimate empty-string argument in the middle of argv survives.
function splitNulSeparated(buffer) {
  const parts = buffer.toString('utf8').split('\0');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// /proc/<pid>/stat's second field (comm) is parenthesized and may itself
// contain spaces or parens, so it's only safely extracted using the LAST
// ')' rather than by naive whitespace splitting from the start of the line.
// comm is kernel-tracked independently of argv, so classifyProcess's
// "does the reported name match what argv[0] claims" check (processSessions.js)
// has a real independent value to compare against here — mirroring why
// Windows sources `name` from CIM rather than from its own CommandLine.
function parseStatFields(statText) {
  const openParen = statText.indexOf('(');
  const closeParen = statText.lastIndexOf(')');
  const comm = statText.slice(openParen + 1, closeParen);
  const afterComm = statText.slice(closeParen + 1).trim();
  return { comm, fields: afterComm.split(/\s+/) };
}

// Pure: given one process's raw /proc reads, produce the normalized row
// shape shared with the Windows/macOS providers, or null when there's
// nothing usable to report (kernel thread, zombie, exited before its
// cmdline could be read).
function parseProcEntry({ pid, cmdlineBuffer, statText, bootTimeEpochSeconds, clockTicksPerSec = CLOCK_TICKS_PER_SEC }) {
  const argv = splitNulSeparated(cmdlineBuffer);
  if (argv.length === 0) return null;
  const { comm, fields } = parseStatFields(statText);
  const parentPid = Number(fields[1]); // stat field 4 (ppid) = fields[1] after the comm split
  const starttimeTicks = Number(fields[19]); // stat field 22 (starttime) = fields[19]
  const createdAt = new Date((bootTimeEpochSeconds + starttimeTicks / clockTicksPerSec) * 1000).toISOString();
  return { name: comm, pid, parentPid, createdAt, argv };
}

async function readBootTimeEpochSeconds() {
  const text = await fs.readFile('/proc/stat', 'utf8');
  const match = text.match(/^btime (\d+)$/m);
  if (!match) throw new Error('Could not determine system boot time');
  return Number(match[1]);
}

async function readLinuxProcesses({ signal } = {}) {
  if (process.platform !== 'linux') return Promise.reject(new Error('Session detection requires native Linux'));
  const uid = process.getuid();
  const bootTimeEpochSeconds = await readBootTimeEpochSeconds();
  const entries = await fs.readdir('/proc');
  const rows = [];
  for (const entry of entries) {
    if (signal?.aborted) throw new Error('Aborted');
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    try {
      const dirStat = await fs.stat(`/proc/${pid}`);
      if (dirStat.uid !== uid) continue;
      const [cmdlineBuffer, statText] = await Promise.all([
        fs.readFile(`/proc/${pid}/cmdline`),
        fs.readFile(`/proc/${pid}/stat`, 'utf8'),
      ]);
      const row = parseProcEntry({ pid, cmdlineBuffer, statText, bootTimeEpochSeconds });
      if (row) rows.push(row);
    } catch {
      // Usually the process exiting between readdir and these per-pid
      // reads — normal churn, not a failed snapshot. Also (deliberately)
      // swallows a malformed /proc/<pid>/stat producing an unparseable
      // row; dropping one unreadable process is a safe failure mode here,
      // so it isn't worth distinguishing from the exit-race case.
    }
  }
  return rows;
}

module.exports = { readLinuxProcesses, parseProcEntry };
