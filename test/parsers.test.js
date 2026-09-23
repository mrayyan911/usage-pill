'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { parseClaudeActivity, IGNORED_TYPES } = require('../src/main/parsers/claudeTranscript');
const { parseCodexRollout } = require('../src/main/parsers/codexRollout');
const { classifyProcess, readSessions } = require('../src/main/parsers/processSessions');
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
