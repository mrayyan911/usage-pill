'use strict';

const { execFile } = require('node:child_process');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function basenamePosix(p) {
  return (p || '').split('/').filter(Boolean).pop() || '';
}

// ps's lstart is "Www Mmm dd hh:mm:ss yyyy" in local time (LC_ALL=C forced
// on the child so weekday/month are always these fixed English
// abbreviations, regardless of the user's locale). Built manually instead
// of Date.parse to avoid relying on engine-specific string-parsing
// heuristics for a format with no timezone marker.
function parseLstart(tokens) {
  const [, month, day, time, year] = tokens;
  const [hh, mm, ss] = time.split(':').map(Number);
  return new Date(Number(year), MONTHS.indexOf(month), Number(day), hh, mm, ss).toISOString();
}

// macOS has no /proc, so argv is reconstructed by re-splitting ps's merged
// `command` column on whitespace. This loses original quoting — a value
// like `-p "Explain --help"` becomes two tokens once ps merges argv into
// one string, and classifyProcess's VALUE_OPTIONS skip only ever consumes
// exactly one token after a flag. That second token can itself be
// something classifyProcess treats as reason to reject the whole process
// (e.g. `--help`), so this isn't a minor misread — it can make a real,
// active session vanish from detection entirely. Getting exact argv
// instead would require reading the kernel's own argv record (macOS's
// sysctl KERN_PROCARGS2) via a native addon; out of scope here, so this
// stays an accepted, documented limitation with a regression test pinning
// down the exact failure shape (see the "known limitation" case in
// parsers.test.js).
function parsePsLine(line) {
  const tokens = line.trim().split(/\s+/);
  if (tokens.length < 8) return null;
  const pid = Number(tokens[0]);
  const parentPid = Number(tokens[1]);
  const createdAt = parseLstart(tokens.slice(2, 7));
  const argv = tokens.slice(7);
  if (argv.length === 0) return null;
  return { name: basenamePosix(argv[0]), pid, parentPid, createdAt, argv };
}

// Pure: parses `ps -o pid,ppid,lstart,command -U <uid>` text output (header
// row included) into the normalized row shape shared with the Windows/Linux
// providers.
function parsePsOutput(stdout) {
  const lines = stdout.split('\n').map(l => l.trimEnd()).filter(Boolean);
  const rows = [];
  for (const line of lines.slice(1)) {
    const row = parsePsLine(line);
    if (row) rows.push(row);
  }
  return rows;
}

function readMacProcesses({ signal } = {}) {
  if (process.platform !== 'darwin') return Promise.reject(new Error('Session detection requires native macOS'));
  const uid = process.getuid();
  return new Promise((resolve, reject) => {
    // -U alone (no -e/-a) selects only this uid's processes: BSD ps unions
    // selection flags rather than intersecting them, so -e -U <uid> would
    // still return every user's processes since -e alone already selects
    // everyone.
    execFile('ps', ['-o', 'pid,ppid,lstart,command', '-U', String(uid)], {
      // COLUMNS forced high: macOS's ps truncates the command column to
      // terminal width even when stdout isn't a TTY. LC_ALL=C: lstart's
      // month/weekday names are otherwise locale-dependent.
      env: { ...process.env, COLUMNS: '10000', LC_ALL: 'C' },
      timeout: 4000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', signal,
    }, (error, stdout) => {
      // Command lines can contain prompts or credentials; never expose them
      // through child-process errors or debug logs.
      if (error) return reject(new Error('macOS process query failed'));
      try { resolve(parsePsOutput(stdout)); }
      catch { reject(new Error('Invalid macOS process snapshot')); }
    });
  });
}

module.exports = { readMacProcesses, parsePsOutput };
