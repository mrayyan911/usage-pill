'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWindowsRows, splitCommandLine } = require('../src/main/providers/windowsProcesses');

test('splitCommandLine keeps a quoted argument containing spaces as one token', () => {
  assert.deepEqual(splitCommandLine('codex.exe exec "Explain --help"'), ['codex.exe', 'exec', 'Explain --help']);
});

test('splitCommandLine resolves backslash-before-quote escaping rules', () => {
  assert.deepEqual(splitCommandLine('codex.exe -c "model=\\"test\\"" exec'), ['codex.exe', '-c', 'model="test"', 'exec']);
  assert.deepEqual(splitCommandLine('"C:\\Tools\\claude.exe"'), ['C:\\Tools\\claude.exe']);
});

test('normalizeWindowsRows maps CIM field names to the shared normalized shape', () => {
  const raw = [{ Name: 'claude.exe', ProcessId: 101, ParentProcessId: 50, CreationDate: '2025-01-01T00:00:00Z', CommandLine: '"C:\\Tools\\claude.exe" -p "hi there"' }];
  assert.deepEqual(normalizeWindowsRows(raw), [{
    name: 'claude.exe', pid: 101, parentPid: 50, createdAt: '2025-01-01T00:00:00Z',
    argv: ['C:\\Tools\\claude.exe', '-p', 'hi there'],
  }]);
});

test('normalizeWindowsRows reports a null argv when CIM could not read the command line', () => {
  const raw = [{ Name: 'codex.exe', ProcessId: 52, ParentProcessId: 51, CreationDate: '2025-01-01T00:00:00Z', CommandLine: null }];
  assert.equal(normalizeWindowsRows(raw)[0].argv, null);
});
