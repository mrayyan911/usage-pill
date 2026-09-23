'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseProcEntry } = require('../src/main/providers/linuxProcesses');

// /proc/<pid>/stat: "pid (comm) state ppid pgrp session tty_nr tpgid flags
// minflt cminflt majflt cmajflt utime stime cutime cstime priority nice
// num_threads itrealvalue starttime ...". starttime is field 22 (clock
// ticks since boot).
function fakeStat({ pid = 103, comm = 'codex', ppid = 102, starttime = 500000 }) {
  const fields = ['S', ppid, 1, 1, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 1, 0, starttime, 0, 0];
  return `${pid} (${comm}) ${fields.join(' ')}`;
}

test('parseProcEntry splits NUL-separated cmdline into exact argv, preserving embedded spaces', () => {
  const cmdlineBuffer = Buffer.from('codex\0exec\0Explain --help\0', 'utf8');
  const row = parseProcEntry({ pid: 103, cmdlineBuffer, statText: fakeStat({ pid: 103 }), bootTimeEpochSeconds: 1_700_000_000 });
  assert.deepEqual(row.argv, ['codex', 'exec', 'Explain --help']);
});

test('parseProcEntry derives name from the kernel-tracked stat comm field, not from argv[0]', () => {
  // A process cannot make itself look like "codex" just by choosing what
  // argv[0] says — comm is reported independently by the kernel, mirroring
  // how the Windows provider's `name` comes from CIM rather than the
  // process's own command line.
  const cmdlineBuffer = Buffer.from('/usr/local/bin/some-other-binary\0exec\0', 'utf8');
  const row = parseProcEntry({ pid: 103, cmdlineBuffer, statText: fakeStat({ pid: 103, comm: 'codex' }), bootTimeEpochSeconds: 1_700_000_000 });
  assert.equal(row.name, 'codex');
});

test('parseProcEntry reads pid and parentPid from the stat line, tolerant of a comm containing spaces/parens', () => {
  const cmdlineBuffer = Buffer.from('node\0/opt/app/server.js\0', 'utf8');
  const row = parseProcEntry({ pid: 200, cmdlineBuffer, statText: fakeStat({ pid: 200, comm: 'weird (name)', ppid: 55 }), bootTimeEpochSeconds: 1_700_000_000 });
  assert.equal(row.pid, 200);
  assert.equal(row.parentPid, 55);
});

test('parseProcEntry converts starttime clock ticks into an absolute ISO timestamp', () => {
  const cmdlineBuffer = Buffer.from('codex\0', 'utf8');
  const bootTimeEpochSeconds = 1_700_000_000;
  const starttime = 12_345; // ticks since boot, 100 ticks/sec assumed
  const row = parseProcEntry({ pid: 1, cmdlineBuffer, statText: fakeStat({ pid: 1, starttime }), bootTimeEpochSeconds });
  assert.equal(row.createdAt, new Date((bootTimeEpochSeconds + starttime / 100) * 1000).toISOString());
});

test('parseProcEntry returns null for a process with no readable cmdline (kernel thread, zombie)', () => {
  const row = parseProcEntry({ pid: 2, cmdlineBuffer: Buffer.alloc(0), statText: fakeStat({ pid: 2, comm: 'kworker' }), bootTimeEpochSeconds: 1_700_000_000 });
  assert.equal(row, null);
});
