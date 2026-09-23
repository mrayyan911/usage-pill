'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { UsageStore } = require('../src/main/stores/usage');

test('UsageStore: before any fetch completes, Claude and Codex report pending rather than error', () => {
  const store = new UsageStore();
  assert.equal(store.getClaudeUsage().status, 'pending');
  assert.equal(store.getCodexUsage().status, 'pending');
});
