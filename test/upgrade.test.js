'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runUpgrade, isNewerVersion } = require('../scripts/upgrade');
const { STOPPED, NOT_RUNNING, STILL_RUNNING } = require('../src/main/quitResult');

function harness({ current = '1.1.2', latest = '1.1.3', quit = STOPPED, installed = true, offline = false, relaunched = true } = {}) {
  const steps = [];
  const messages = [];
  const deps = {
    currentVersion: current,
    fetchLatestVersion: async () => { steps.push('check'); if (offline) throw new Error('offline'); return latest; },
    quitRunningPill: async () => { steps.push('quit'); return quit; },
    installVersion: async version => { steps.push(`install ${version}`); return installed; },
    launchMonitor: async () => { steps.push('relaunch'); return relaunched; },
    log: message => messages.push(message),
  };
  return { steps, messages, run: () => runUpgrade(deps) };
}

test('a newer version closes the running pill, installs that exact version, then relaunches the monitor', async () => {
  const upgrade = harness();
  await upgrade.run();
  assert.deepEqual(upgrade.steps, ['check', 'quit', 'install 1.1.3', 'relaunch']);
  assert.match(upgrade.messages.at(-1), /1\.1\.2 -> 1\.1\.3.*restarted/);
});

test('a monitor that fails to relaunch is not reported as restarted', async () => {
  const upgrade = harness({ relaunched: false });
  await upgrade.run();
  assert.deepEqual(upgrade.steps, ['check', 'quit', 'install 1.1.3', 'relaunch']);
  assert.doesNotMatch(upgrade.messages.at(-1), /restarted/);
});

test('with no pill running, upgrading installs without starting one', async () => {
  const upgrade = harness({ quit: NOT_RUNNING });
  await upgrade.run();
  assert.deepEqual(upgrade.steps, ['check', 'quit', 'install 1.1.3']);
});

test('an up-to-date install leaves the running pill alone', async () => {
  const upgrade = harness({ latest: '1.1.2' });
  await upgrade.run();
  assert.deepEqual(upgrade.steps, ['check']);
  assert.match(upgrade.messages[0], /already up to date/);
});

test('a registry version older than the installed one is never installed', async () => {
  const upgrade = harness({ current: '1.2.0', latest: '1.1.9' });
  await upgrade.run();
  assert.deepEqual(upgrade.steps, ['check']);
});

test('being unable to reach npm fails before the running pill is closed', async () => {
  const upgrade = harness({ offline: true });
  await assert.rejects(upgrade.run(), /Could not reach npm.*Nothing was changed/);
  assert.deepEqual(upgrade.steps, ['check']);
});

test('an unexpected registry version string is rejected before anything is closed or installed', async () => {
  const upgrade = harness({ latest: '1.2.0 && calc' });
  await assert.rejects(upgrade.run(), /unexpected latest version/);
  assert.deepEqual(upgrade.steps, ['check']);
});

test('a pill that ignores the quit request blocks the install instead of hitting a locked file', async () => {
  const upgrade = harness({ quit: STILL_RUNNING });
  await assert.rejects(upgrade.run(), /did not quit.*tray menu/);
  assert.deepEqual(upgrade.steps, ['check', 'quit']);
});

test('a pill that could not be asked to quit also blocks the install', async () => {
  const upgrade = harness({ quit: null });
  await assert.rejects(upgrade.run(), /did not quit/);
  assert.deepEqual(upgrade.steps, ['check', 'quit']);
});

test('a failed install still relaunches the previous version and says how to retry', async () => {
  const upgrade = harness({ installed: false });
  await assert.rejects(upgrade.run(), /could not install 1\.1\.3; usage-pill 1\.1\.2 is still installed.*npm install -g @mrayyan911\/usage-pill/);
  assert.deepEqual(upgrade.steps, ['check', 'quit', 'install 1.1.3', 'relaunch']);
});

test('version comparison is numeric per segment, not lexical', () => {
  assert.equal(isNewerVersion('1.1.10', '1.1.9'), true);
  assert.equal(isNewerVersion('1.10.0', '1.9.9'), true);
  assert.equal(isNewerVersion('2.0.0', '1.99.99'), true);
  assert.equal(isNewerVersion('1.1.2', '1.1.2'), false);
  assert.equal(isNewerVersion('1.1.1', '1.1.2'), false);
});
