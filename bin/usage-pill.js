#!/usr/bin/env node
'use strict';

const { runSubcommand } = require('../scripts/launcher');

try {
  runSubcommand(process.argv[2], {
    setup: 'usage-pill setup',
    monitor: 'usage-pill monitor',
    removePackage: 'npm uninstall -g @mrayyan911/usage-pill',
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
