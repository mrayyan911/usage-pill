'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runElectron } = require('./electronRunner.cjs');

test('Codex process snapshot reaches the renderer without presenting missing usage as OFFLINE', () => {
  const result = runElectron('codex-session.cjs', 15_000);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
