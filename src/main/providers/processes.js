'use strict';

const { readWindowsProcesses } = require('./windowsProcesses');
const { readMacProcesses } = require('./macProcesses');
const { readLinuxProcesses } = require('./linuxProcesses');

const PROVIDERS = { win32: readWindowsProcesses, darwin: readMacProcesses, linux: readLinuxProcesses };

function selectReadProcesses(platform = process.platform, providers = PROVIDERS) {
  const provider = providers[platform];
  if (!provider) throw new Error(`Session detection is not supported on ${platform}`);
  return provider;
}

function readProcesses(options) {
  return selectReadProcesses()(options);
}

module.exports = { readProcesses, selectReadProcesses };
