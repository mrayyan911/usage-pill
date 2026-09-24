'use strict';

const { runSubcommand } = require('./launcher');

const action = process.argv[2];
if (!['setup', 'setup:remove', 'uninstall'].includes(action)) {
  console.error('Use npm run setup, npm run setup:remove, or npm run remove.');
  process.exit(1);
}
runSubcommand(action, { setup: 'npm run setup', monitor: 'npm run monitor' });
