'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./fixtures/processes.json');
const { SessionStore } = require('../src/main/stores/sessions');

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
