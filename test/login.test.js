'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { configureLogin } = require('../src/main/login');

test('source setup registers the quoted checkout path and monitor mode, then verifies registration', () => {
  let written;
  const app = {
    isPackaged: false,
    getAppPath: () => 'D:\\My Projects\\usage-pill',
    setLoginItemSettings: settings => { written = settings; },
    getLoginItemSettings: () => ({ launchItems: [{ name: 'UsagePill', path: 'C:\\Electron\\electron.exe', enabled: written.enabled }] }),
  };
  configureLogin(app, true, 'C:\\Electron\\electron.exe');
  assert.equal(written.openAtLogin, true);
  assert.equal(written.name, 'UsagePill');
  configureLogin(app, false, 'C:\\Electron\\electron.exe');
  assert.equal(written.openAtLogin, false);
});

test('packaged setup does not pass a source directory; failed registration is reported', () => {
  const app = {
    isPackaged: true,
    setLoginItemSettings: settings => assert.deepEqual(settings.args, ['--monitor']),
    getLoginItemSettings: () => ({ launchItems: [] }),
  };
  assert.throws(() => configureLogin(app, true, 'C:\\UsagePill.exe'), /startup/i);
});

test('registration under a different identity (AppUserModelID mismatch) does not count as verified', () => {
  const app = {
    isPackaged: true,
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({ launchItems: [{ name: 'UsagePill', path: 'C:\\Other\\electron.exe', enabled: true }] }),
  };
  assert.throws(() => configureLogin(app, true, 'C:\\UsagePill.exe'), /startup/i);
});

test('removal is verified when Windows leaves no matching launch item at all', () => {
  const app = {
    isPackaged: true,
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({ launchItems: [] }),
  };
  configureLogin(app, false, 'C:\\UsagePill.exe');
});
