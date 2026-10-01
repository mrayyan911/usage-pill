'use strict';

function resolveSubcommandArgs(subcommand) {
  if (subcommand === undefined) return [];
  if (subcommand === 'setup') return ['--setup'];
  if (subcommand === 'setup:remove') return ['--remove-startup'];
  if (subcommand === 'monitor') return ['--monitor'];
  if (subcommand === 'uninstall') return ['--uninstall'];
  if (subcommand === 'upgrade') return ['--quit'];
  throw new Error(`Unrecognized command "${subcommand}". Use one of: setup, setup:remove, monitor, upgrade, uninstall.`);
}

module.exports = { resolveSubcommandArgs };
