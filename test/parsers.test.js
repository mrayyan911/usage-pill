'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseClaudeActivity, IGNORED_TYPES } = require('../src/main/parsers/claudeTranscript');
const { parseCodexRollout } = require('../src/main/parsers/codexRollout');
const { classifyProcess, readSessions } = require('../src/main/parsers/processSessions');
const { normalizeWindowsRows, splitCommandLine } = require('../src/main/providers/windowsProcesses');
const { parsePsOutput } = require('../src/main/providers/macProcesses');
const { parseProcEntry } = require('../src/main/providers/linuxProcesses');
const processesFixture = require('./fixtures/processes.json');
const codexWindows = require('./fixtures/codex-windows-processes.json');

test('captured Windows npm Codex tree identifies the CLI independently of its shell and terminal host', () => {
  for (const rows of [codexWindows, codexWindows.slice(0, 3), [codexWindows[2]]]) {
    assert.deepEqual(readSessions(rows).map(s => [s.agent, s.pid]), [['codex', 52]]);
  }
  assert.deepEqual(readSessions(codexWindows.filter(r => !['node.exe', 'codex.exe'].includes(r.name))), []);
});

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('claude: last real record end_turn -> idle', () => {
  const state = parseClaudeActivity(fixture('claude-transcript.jsonl'));
  assert.equal(state, 'idle');
});

test('claude: sidecar records after end_turn do not flip state back to working', () => {
  // The fixture's last 5 lines are timestamp-less sidecars written after the
  // end_turn assistant record. They must be transparent to the scan.
  const text = fixture('claude-transcript.jsonl');
  const lines = text.trim().split('\n');
  for (const line of lines.slice(-5)) {
    const record = JSON.parse(line);
    assert.ok(IGNORED_TYPES.has(record.type) || record.type === 'attachment');
  }
});

test('claude: truncated to just the tool_use turn -> working', () => {
  const lines = fixture('claude-transcript.jsonl').trim().split('\n').slice(0, 2);
  const state = parseClaudeActivity(lines.join('\n'));
  assert.equal(state, 'working');
});

test('claude: truncated to the tool_result-awaiting-model turn -> working', () => {
  const lines = fixture('claude-transcript.jsonl').trim().split('\n').slice(0, 3);
  const state = parseClaudeActivity(lines.join('\n'));
  assert.equal(state, 'working');
});

test('claude: corrupt leading fragment from a tail read is skipped, not fatal', () => {
  const text = fixture('claude-transcript.jsonl');
  const tail = '{"broken json fragmen' + text; // simulate a mid-line tail read
  assert.doesNotThrow(() => parseClaudeActivity(tail));
});

test('claude: empty/unknown transcript -> unknown', () => {
  assert.equal(parseClaudeActivity(''), 'unknown');
});

test('codex: root/user thread is identified and its rate_limits are read', () => {
  const { isUserThread, rateLimits, activity } = parseCodexRollout(
    fixture('codex-rollout-root.jsonl')
  );
  assert.equal(isUserThread, true);
  assert.equal(rateLimits.primary.used_percent, 10.0);
  assert.equal(rateLimits.secondary.used_percent, 2.0);
  // last task_started (b1) has no matching task_complete -> working
  assert.equal(activity, 'working');
});

test('codex: subagent thread is flagged as non-user and still yields activity', () => {
  const { isUserThread, rateLimits, activity } = parseCodexRollout(
    fixture('codex-rollout-subagent.jsonl')
  );
  assert.equal(isUserThread, false);
  // rateLimits is still parsed (caller decides whether to trust it for usage)
  assert.equal(rateLimits.primary.used_percent, 99.0);
  assert.equal(activity, 'idle'); // its one task_started has a matching task_complete
});

test('codex: a subagent whose rate_limits differ from root must not be mistaken for usage', () => {
  // This is the "subagent trap" the technical review flagged: the subagent
  // fixture deliberately carries wildly different numbers (99%/50%) so a
  // caller that forgets to check isUserThread will fail obviously, not subtly.
  const root = parseCodexRollout(fixture('codex-rollout-root.jsonl'));
  const sub = parseCodexRollout(fixture('codex-rollout-subagent.jsonl'));
  assert.notEqual(root.rateLimits.primary.used_percent, sub.rateLimits.primary.used_percent);
  assert.equal(root.isUserThread, true);
  assert.equal(sub.isUserThread, false);
});

test('codex: empty content -> unknown activity, null rate_limits, not a user thread', () => {
  const result = parseCodexRollout('');
  assert.equal(result.activity, 'unknown');
  assert.equal(result.rateLimits, null);
  assert.equal(result.isUserThread, false);
});

test('detects native and npm sessions without double-counting a launcher and its child', () => {
  const sessions = readSessions(processesFixture);
  assert.deepEqual(sessions.map(s => [s.agent, s.pid]), [['claude', 101], ['codex', 103], ['claude', 104]]);
});

test('excludes utility commands and services, including options before the command', () => {
  for (const argv of [
    ['codex.exe', '--version'], ['codex.exe', '-V'], ['codex.exe', '--help'],
    ['codex.exe', 'exec', '--help'], ['codex.exe', '-c', 'model=x', 'app-server'],
    ['codex.exe', 'mcp-server'], ['codex.exe', 'login'], ['codex.exe', 'completion', 'powershell'],
    ['codex.exe', 'exec-server'], ['codex.exe', 'help', 'exec'],
  ]) {
    assert.equal(classifyProcess({ name: 'codex.exe', argv }), null, argv.join(' '));
  }
  for (const argv of [
    ['claude.exe', '--version'], ['claude.exe', '-v'], ['claude.exe', 'doctor'],
    ['claude.exe', 'auth', 'status'], ['claude.exe', 'mcp', 'serve'],
    ['claude.exe', '--model', 'sonnet', 'update'], ['claude.exe', '--chrome-native-host'],
  ]) {
    assert.equal(classifyProcess({ name: 'claude.exe', argv }), null, argv.join(' '));
  }
});

test('a print prompt that is itself a utility-command word is still a session, not a utility command', () => {
  assert.equal(classifyProcess({ name: 'claude.exe', argv: ['claude.exe', '-p', 'help'] }), 'claude');
  assert.equal(classifyProcess({ name: 'claude.exe', argv: ['claude.exe', '--print', 'doctor'] }), 'claude');
});

test('accepts prompts containing command names or help text without interpreting their contents', () => {
  for (const argv of [
    ['codex.exe', 'exec', 'Explain --help'],
    ['codex.exe', 'app-server details'],
    ['codex.exe', '--', '--help'],
    ['codex.exe', 'resume', '--last'],
    ['codex.exe', '--model', 'help', 'exec', 'hello'],
    ['codex.exe', '-c', 'model="test"', 'exec', 'hi'],
  ]) {
    assert.equal(classifyProcess({ name: 'codex.exe', argv }), 'codex', argv.join(' '));
  }
  assert.equal(classifyProcess({ name: 'claude.exe', argv: ['claude.exe', '-p', 'Explain --help'] }), 'claude');
});

test('excludes Claude Desktop, whose claude.exe is indistinguishable from the CLI by name alone', () => {
  const desktopMain = 'claude.exe';
  const desktopExe = 'C:\\Program Files\\WindowsApps\\Claude_1.0.0.0_x64__abc123\\app\\claude.exe';
  assert.equal(classifyProcess({ name: desktopMain, argv: [desktopExe] }), null);
  assert.equal(classifyProcess({ name: desktopMain, argv: [desktopExe, '--type=renderer'] }), null);
  const perUserExe = 'C:\\Users\\me\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\claude.exe';
  assert.equal(classifyProcess({ name: desktopMain, argv: [perUserExe] }), null);
});

test('classifyProcess treats extension-less POSIX process names the same as Windows .exe names', () => {
  assert.equal(classifyProcess({ name: 'codex', argv: ['/usr/local/bin/codex', 'exec', 'hi'] }), 'codex');
  assert.equal(classifyProcess({ name: 'claude', argv: ['claude', '--version'] }), null);
  assert.equal(classifyProcess({ name: 'node', argv: ['node', '/opt/app/node_modules/@openai/codex/bin/codex.js', 'exec'] }), 'codex');
});

test('unrelated node commands cannot impersonate a CLI through prompt text', () => {
  assert.equal(classifyProcess({ name: 'node.exe', argv: ['node', 'server.js', 'C:\\node_modules\\@openai\\codex\\bin\\codex.js'] }), null);
  assert.equal(classifyProcess({ name: 'node.exe', argv: ['node', '-e', 'codex'] }), null);
  assert.equal(classifyProcess({ name: 'codex.exe', argv: null }), undefined);
});

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

// `ps -o pid,ppid,lstart,command -U <uid>` output shape (LC_ALL=C forced so
// weekday and month names are always these fixed English abbreviations).
const macPsLines = fixture('mac-ps-output.txt').split('\n');
const macPsHeader = macPsLines[0];
const macPsRow = (line) => [macPsHeader, line].join('\n');

test('parsePsOutput skips the header row and parses pid/ppid/command', () => {
  const rows = parsePsOutput(macPsRow(macPsLines[1]));
  assert.deepEqual(rows, [{
    name: 'codex', pid: 103, parentPid: 102,
    createdAt: new Date(2025, 0, 15, 9, 30, 0).toISOString(),
    argv: ['/usr/local/bin/codex', 'exec', 'hi'],
  }]);
});

test('parsePsOutput handles a single-digit day padded with an extra space in lstart', () => {
  const rows = parsePsOutput(macPsRow(macPsLines[2]));
  assert.equal(rows[0].createdAt, new Date(2025, 0, 1, 0, 0, 0).toISOString());
});

test('parsePsOutput derives name from the basename of argv[0]', () => {
  assert.equal(parsePsOutput(macPsRow(macPsLines[3]))[0].name, 'claude');
});

test('parsePsOutput skips blank lines and ignores unrelated processes (still emits a row for the classifier to reject)', () => {
  const rows = parsePsOutput([macPsHeader, macPsLines[4], macPsLines[5]].join('\n'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'launchd');
});

test('known limitation: a macOS value spanning two words that itself contains a reserved token drops the session', () => {
  // Regression pin for the case described in macProcesses.js's parsePsLine
  // comment: ps merges argv into one string with no quote boundary, so
  // `-p "Explain --help"` is indistinguishable here from `-p Explain --help`.
  // classifyProcess correctly rejects the latter, so this session is lost —
  // an accepted, understood limitation of the ps-based approach, not a bug
  // introduced by the classifier itself.
  const rows = parsePsOutput(macPsRow(macPsLines[6]));
  assert.deepEqual(rows[0].argv, ['/usr/local/bin/codex', 'exec', 'Explain', '--help']);
  assert.equal(classifyProcess(rows[0]), null);
});

// /proc/<pid>/stat: "pid (comm) state ppid pgrp session tty_nr tpgid flags
// minflt cminflt majflt cmajflt utime stime cutime cstime priority nice
// num_threads itrealvalue starttime ...". starttime is field 22 (clock
// ticks since boot).
function fakeLinuxStat({ pid = 103, comm = 'codex', ppid = 102, starttime = 500000 }) {
  const fields = ['S', ppid, 1, 1, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 0, 1, 0, starttime, 0, 0];
  return `${pid} (${comm}) ${fields.join(' ')}`;
}

test('parseProcEntry splits NUL-separated cmdline into exact argv, preserving embedded spaces', () => {
  const cmdlineBuffer = fs.readFileSync(path.join(__dirname, 'fixtures', 'linux-cmdline-embedded-space.bin'));
  const row = parseProcEntry({ pid: 103, cmdlineBuffer, statText: fakeLinuxStat({ pid: 103 }), bootTimeEpochSeconds: 1_700_000_000 });
  assert.deepEqual(row.argv, ['codex', 'exec', 'Explain --help']);
});

test('parseProcEntry derives name from the kernel-tracked stat comm field, not from argv[0]', () => {
  // A process cannot make itself look like "codex" just by choosing what
  // argv[0] says — comm is reported independently by the kernel, mirroring
  // how the Windows provider's `name` comes from CIM rather than the
  // process's own command line.
  const cmdlineBuffer = Buffer.from('/usr/local/bin/some-other-binary\0exec\0', 'utf8');
  const row = parseProcEntry({ pid: 103, cmdlineBuffer, statText: fakeLinuxStat({ pid: 103, comm: 'codex' }), bootTimeEpochSeconds: 1_700_000_000 });
  assert.equal(row.name, 'codex');
});

test('parseProcEntry reads pid and parentPid from the stat line, tolerant of a comm containing spaces/parens', () => {
  const cmdlineBuffer = Buffer.from('node\0/opt/app/server.js\0', 'utf8');
  const row = parseProcEntry({ pid: 200, cmdlineBuffer, statText: fakeLinuxStat({ pid: 200, comm: 'weird (name)', ppid: 55 }), bootTimeEpochSeconds: 1_700_000_000 });
  assert.equal(row.pid, 200);
  assert.equal(row.parentPid, 55);
});

test('parseProcEntry converts starttime clock ticks into an absolute ISO timestamp', () => {
  const cmdlineBuffer = Buffer.from('codex\0', 'utf8');
  const bootTimeEpochSeconds = 1_700_000_000;
  const starttime = 12_345; // ticks since boot, 100 ticks/sec assumed
  const row = parseProcEntry({ pid: 1, cmdlineBuffer, statText: fakeLinuxStat({ pid: 1, starttime }), bootTimeEpochSeconds });
  assert.equal(row.createdAt, new Date((bootTimeEpochSeconds + starttime / 100) * 1000).toISOString());
});

test('parseProcEntry returns null for a process with no readable cmdline (kernel thread, zombie)', () => {
  const row = parseProcEntry({ pid: 2, cmdlineBuffer: Buffer.alloc(0), statText: fakeLinuxStat({ pid: 2, comm: 'kworker' }), bootTimeEpochSeconds: 1_700_000_000 });
  assert.equal(row, null);
});
