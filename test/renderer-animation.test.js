'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runElectron } = require('./electronRunner.cjs');

test('pill morph stays within its endpoints through collapse and hover reversals', () => {
  const result = runElectron('renderer-animation.cjs', 60_000);
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
