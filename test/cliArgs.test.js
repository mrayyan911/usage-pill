'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveSubcommandArgs } = require('../scripts/cliArgs');

test('no subcommand launches foreground with no extra flags', () => {
  assert.deepEqual(resolveSubcommandArgs(undefined), []);
});

test('setup subcommand maps to --setup', () => {
  assert.deepEqual(resolveSubcommandArgs('setup'), ['--setup']);
});

test('setup:remove subcommand maps to --remove-startup', () => {
  assert.deepEqual(resolveSubcommandArgs('setup:remove'), ['--remove-startup']);
});

test('monitor subcommand maps to --monitor', () => {
  assert.deepEqual(resolveSubcommandArgs('monitor'), ['--monitor']);
});

test('uninstall subcommand maps to --uninstall', () => {
  assert.deepEqual(resolveSubcommandArgs('uninstall'), ['--uninstall']);
});

test('unrecognized subcommand throws a clear error naming it', () => {
  assert.throws(() => resolveSubcommandArgs('bogus'), /Unrecognized command "bogus"/);
});
