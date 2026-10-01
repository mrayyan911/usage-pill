'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UsageStore } = require('../src/main/stores/usage');
const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function setup() {
  const filename = require.resolve('../src/main/stores/usage');
  const localRequire = createRequire(filename);
  const input = { now: 1_000_000, claude: { status: 'error' }, codex: { usage: { status: 'error' } }, requests: 0 };
  const deps = {
    '../providers/claude': { fetchClaudeUsage: async () => { input.requests++; return input.claude; } },
    '../providers/codex': { readCodexSnapshot: () => input.codex },
  };
  const context = { module: { exports: {} }, require: name => deps[name] || localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return { input, store: new context.module.exports.UsageStore({ now: () => input.now }) };
}

test('Claude usage does not display a previous window after reset when refresh fails', async () => {
  const { input, store } = setup();
  input.claude = { status: 'ok', percent: 85, resetsAt: new Date(input.now + 60_000), weeklyPercent: 30 };
  await store._refreshClaude();
  input.now += 86_400_000;
  input.claude = { status: 'error' };
  await store._refreshClaude();
  assert.equal(store.getClaudeUsage().percent, null);
  assert.equal(store.getClaudeUsage().status, 'stale');
});

test('Codex usage clears a cached percentage when a new root has no reading', () => {
  const { input, store } = setup();
  input.codex = { usage: { status: 'ok', percent: 75 } };
  store.refreshCodex();
  input.codex = { usage: { status: 'error', percent: null }, hasFiles: true };
  assert.equal(store.refreshCodex().percent, null);
});

test('repeated Codex polls do not make an old sample fresh', () => {
  const { input, store } = setup();
  input.codex = { usage: { status: 'ok', percent: 75 }, usageObservedAtMs: input.now };
  store.refreshCodex();
  input.now += 86_400_000;
  assert.equal(store.refreshCodex().status, 'stale');
});

test('Claude reset expires at the boundary without a fetch, preserves the valid weekly reading, and recovers', async () => {
  const { input, store } = setup();
  const reset = input.now + 60_000;
  input.claude = { status: 'ok', percent: 85, resetsAt: new Date(reset), weeklyPercent: 30,
    weeklyResetsAt: new Date(reset + 86_400_000) };
  await store._refreshClaude();
  input.now = reset - 1;
  assert.equal(store.getClaudeUsage().percent, 85);
  input.now = reset;
  assert.equal(store.getClaudeUsage().percent, null);
  assert.equal(store.getClaudeUsage().weeklyPercent, 30);
  input.claude = { ...input.claude, percent: 0, resetsAt: new Date(reset + 60_000) };
  await store._refreshClaude();
  assert.equal(store.getClaudeUsage().percent, 0, 'an actual provider-reported zero is valid');
  assert.equal(store.getClaudeUsage().status, 'ok');
});

test('UsageStore: before any fetch completes, Claude and Codex report pending rather than error', () => {
  const store = new UsageStore();
  assert.equal(store.getClaudeUsage().status, 'pending');
  assert.equal(store.getCodexUsage().status, 'pending');
});
