'use strict';

function resolveSubcommandArgs(subcommand) {
  if (subcommand === undefined) return [];
  if (subcommand === 'setup') return ['--setup'];
  if (subcommand === 'setup:remove') return ['--remove-startup'];
  if (subcommand === 'monitor') return ['--monitor'];
  throw new Error(`Unrecognized command "${subcommand}". Use one of: setup, setup:remove, monitor.`);
}

module.exports = { resolveSubcommandArgs };
