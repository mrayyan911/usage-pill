'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runElectron } = require('./electronRunner.cjs');

test('agent details retain usage, distinguish approval, and support keyboard inspection', () => {
  const result = runElectron('renderer-details.cjs');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
