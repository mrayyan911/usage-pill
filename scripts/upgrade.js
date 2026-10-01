'use strict';

const { STOPPED, NOT_RUNNING } = require('../src/main/quitResult');

const PACKAGE_NAME = '@mrayyan911/usage-pill';
const MANUAL_UPGRADE = `npm install -g ${PACKAGE_NAME}`;
const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;

function isNewerVersion(candidate, current) {
  const a = candidate.split('.').map(Number);
  const b = current.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

// Checks the registry before quitting anything, so being offline or already
// current never closes a pill that would then have nothing to replace it.
async function runUpgrade({ currentVersion, fetchLatestVersion, quitRunningPill, installVersion, launchMonitor, log = console.log }) {
  let latest;
  try { latest = await fetchLatestVersion(); }
  catch { throw new Error('Could not reach npm to check for a newer version. Nothing was changed.'); }
  if (!RELEASE_VERSION.test(latest)) throw new Error(`npm reported an unexpected latest version "${latest}". Nothing was changed.`);
  if (!isNewerVersion(latest, currentVersion)) {
    log(`usage-pill ${currentVersion} is already up to date.`);
    return;
  }

  const quit = await quitRunningPill();
  if (quit !== STOPPED && quit !== NOT_RUNNING) {
    throw new Error('The running pill did not quit, so nothing was changed. Use Quit in its tray menu, then run usage-pill upgrade again.');
  }
  const wasRunning = quit === STOPPED;
  if (wasRunning) log('Closed the running pill.');

  log(`Installing ${PACKAGE_NAME}@${latest}...`);
  const installed = await installVersion(latest);
  // npm rolls a failed global install back, so the old version is still
  // usable and is relaunched rather than leaving the user with no pill.
  const relaunched = wasRunning && await launchMonitor();
  if (!installed) throw new Error(`npm could not install ${latest}; usage-pill ${currentVersion} is still installed. Retry with: ${MANUAL_UPGRADE}`);
  log(`Upgraded usage-pill ${currentVersion} -> ${latest}.${relaunched ? ' The monitor was restarted.' : ''}`);
}

module.exports = { runUpgrade, isNewerVersion, PACKAGE_NAME };
