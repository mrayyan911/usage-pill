'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/processes.json');
const { readSessions, classifyProcess } = require('../src/main/parsers/processSessions');
const { SessionStore } = require('../src/main/stores/sessions');

test('detects native and npm sessions without double-counting a launcher and its child', () => {
  const sessions = readSessions(fixture);
  assert.deepEqual(sessions.map(s => [s.agent, s.pid]), [['claude', 101], ['codex', 103], ['claude', 104]]);
});

test('excludes utility commands and services, including options before the command', () => {
  for (const args of ['--version', '-V', '--help', 'exec --help', '-c model="x" app-server', 'mcp-server', 'login', 'completion powershell', 'exec-server', 'help exec']) {
    assert.equal(classifyProcess({ Name: 'codex.exe', CommandLine: `codex.exe ${args}` }), null, args);
  }
  for (const args of ['--version', '-v', 'doctor', 'auth status', 'mcp serve', '--model sonnet update', '--chrome-native-host']) {
    assert.equal(classifyProcess({ Name: 'claude.exe', CommandLine: `claude.exe ${args}` }), null, args);
  }
});

test('accepts prompts containing command names or help text without interpreting their contents', () => {
  for (const args of ['exec "Explain --help"', '"app-server details"', '-- "--help"', 'resume --last', '--model help exec "hello"', '-c "model=\\\"test\\\"" exec "hi"']) {
    assert.equal(classifyProcess({ Name: 'codex.exe', CommandLine: `codex.exe ${args}` }), 'codex', args);
  }
  assert.equal(classifyProcess({ Name: 'claude.exe', CommandLine: 'claude.exe -p "Explain --help"' }), 'claude');
});

test('excludes Claude Desktop, whose claude.exe is indistinguishable from the CLI by name alone', () => {
  const desktopMain = 'claude.exe';
  const desktopExe = 'C:\\Program Files\\WindowsApps\\Claude_1.0.0.0_x64__abc123\\app\\claude.exe';
  assert.equal(classifyProcess({ Name: desktopMain, CommandLine: `"${desktopExe}"` }), null);
  assert.equal(classifyProcess({ Name: desktopMain, CommandLine: `"${desktopExe}" --type=renderer` }), null);
  const perUserExe = 'C:\\Users\\me\\AppData\\Local\\AnthropicClaude\\app-1.0.0\\claude.exe';
  assert.equal(classifyProcess({ Name: desktopMain, CommandLine: `"${perUserExe}"` }), null);
});

test('unrelated node commands cannot impersonate a CLI through prompt text', () => {
  assert.equal(classifyProcess({ Name: 'node.exe', CommandLine: 'node server.js "C:\\node_modules\\@openai\\codex\\bin\\codex.js"' }), null);
  assert.equal(classifyProcess({ Name: 'node.exe', CommandLine: 'node -e "codex"' }), null);
  assert.equal(classifyProcess({ Name: 'codex.exe', CommandLine: null }), undefined);
});

test('snapshot failure retains sessions; a successful empty snapshot closes them', async () => {
  let rows = fixture;
  const store = new SessionStore({ readProcesses: async () => { if (rows === null) throw new Error('unavailable'); return rows; } });
  await store.poll();
  assert.deepEqual(store.getSnapshot().agents, ['claude', 'codex']);
  rows = null;
  await store.poll();
  assert.deepEqual(store.getSnapshot().agents, ['claude', 'codex']);
  assert.equal(store.getSnapshot().status, 'error');
  rows = [];
  await store.poll();
  assert.deepEqual(store.getSnapshot(), { agents: [], status: 'ok' });
});

test('unreadable command line retains only a previously identified process with the same creation time', async () => {
  let rows = [fixture[0]];
  const store = new SessionStore({ readProcesses: async () => rows });
  await store.poll();
  rows = [{ ...fixture[0], CommandLine: null }];
  await store.poll();
  assert.deepEqual(store.getSnapshot().agents, ['claude']);
  rows = [{ ...rows[0], CreationDate: '2025-01-02T00:00:00Z' }];
  await store.poll();
  assert.deepEqual(store.getSnapshot().agents, []);
});

test('concurrent polling shares the in-flight read', async () => {
  let finish;
  let calls = 0;
  const store = new SessionStore({ readProcesses: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const a = store.poll();
  const b = store.poll();
  await Promise.resolve();
  finish([]);
  await Promise.all([a, b]);
  assert.equal(calls, 1);
});
