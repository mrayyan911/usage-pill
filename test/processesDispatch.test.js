'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectReadProcesses } = require('../src/main/providers/processes');

test('selectReadProcesses picks the provider matching the given platform', () => {
  const providers = { win32: () => 'windows', darwin: () => 'mac', linux: () => 'linux' };
  assert.equal(selectReadProcesses('win32', providers)(), 'windows');
  assert.equal(selectReadProcesses('darwin', providers)(), 'mac');
  assert.equal(selectReadProcesses('linux', providers)(), 'linux');
});

test('selectReadProcesses throws a clear error for an unsupported platform', () => {
  assert.throws(() => selectReadProcesses('freebsd', {}), /freebsd/);
});
