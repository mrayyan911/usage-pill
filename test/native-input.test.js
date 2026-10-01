'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runElectron } = require('./electronRunner.cjs');

test('Windows native input reaches the app underneath pill margins and can inspect and drag the pill',
  { skip: process.platform !== 'win32' }, () => {
    const result = runElectron('native-input.cjs', 60_000);
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });
