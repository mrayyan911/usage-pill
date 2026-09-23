'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('agent details retain usage, distinguish approval, and support keyboard inspection', () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [path.join(__dirname, 'renderer-details.cjs')], {
    env, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
