'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/processes.json');
const { SessionStore } = require('../src/main/stores/sessions');
const { reduce } = require('../src/main/reduce');
const { EMPTY_USAGE } = require('../src/main/usageShape');

test('session polling discovers starts, concurrent agents, and exits despite missing usage or stale activity', async () => {
  const codex = require('./fixtures/codex-windows-processes.json');
  let rows = [];
  const store = new SessionStore({ readProcesses: async () => rows });
  for (const [processes, expected] of [[[], []], [codex, ['codex']],
    [[fixture[0], ...codex], ['claude', 'codex']], [[fixture[0]], ['claude']], [[], []]]) {
    rows = processes;
    await store.poll();
    assert.deepEqual(store.getSnapshot().agents, expected);
    const state = reduce({ sessionAgents: store.getSnapshot().agents,
      activitySnapshot: { active: 'claude', claude: 'working', codex: 'idle' },
      claudeUsage: { ...EMPTY_USAGE, status: 'error' }, codexUsage: { ...EMPTY_USAGE, status: 'error' } });
    assert.deepEqual(state.agents.map(r => r.agent), expected.length ? expected : [null]);
  }
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
  rows = [{ ...fixture[0], argv: null }];
  await store.poll();
  assert.deepEqual(store.getSnapshot().agents, ['claude']);
  rows = [{ ...rows[0], createdAt: '2025-01-02T00:00:00Z' }];
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
