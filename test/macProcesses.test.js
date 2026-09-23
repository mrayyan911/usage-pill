'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePsOutput } = require('../src/main/providers/macProcesses');

// `ps -eo pid,ppid,lstart,command` output shape (LC_ALL=C forced so weekday
// and month names are always these fixed English abbreviations).
const HEADER = '  PID  PPID                  STARTED COMMAND';

test('parsePsOutput skips the header row and parses pid/ppid/command', () => {
  const stdout = [HEADER, '  103   102 Wed Jan 15 09:30:00 2025 /usr/local/bin/codex exec hi'].join('\n');
  const rows = parsePsOutput(stdout);
  assert.deepEqual(rows, [{
    name: 'codex', pid: 103, parentPid: 102,
    createdAt: new Date(2025, 0, 15, 9, 30, 0).toISOString(),
    argv: ['/usr/local/bin/codex', 'exec', 'hi'],
  }]);
});

test('parsePsOutput handles a single-digit day padded with an extra space in lstart', () => {
  const stdout = [HEADER, '   50    40 Wed Jan  1 00:00:00 2025 /usr/bin/node server.js'].join('\n');
  const rows = parsePsOutput(stdout);
  assert.equal(rows[0].createdAt, new Date(2025, 0, 1, 0, 0, 0).toISOString());
});

test('parsePsOutput derives name from the basename of argv[0]', () => {
  const stdout = [HEADER, '  200   100 Mon Feb 10 12:00:00 2025 /Applications/Utilities/claude --version'].join('\n');
  assert.equal(parsePsOutput(stdout)[0].name, 'claude');
});

test('parsePsOutput skips blank lines and ignores unrelated processes (still emits a row for the classifier to reject)', () => {
  const stdout = [HEADER, '', '   10     1 Mon Feb 10 12:00:00 2025 /sbin/launchd'].join('\n');
  const rows = parsePsOutput(stdout);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'launchd');
});
