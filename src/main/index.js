'use strict';

const path = require('node:path');
const { app } = require('electron');

const { createPillWindow } = require('./window');
const { ActivityStore } = require('./stores/activity');
const { UsageStore } = require('./stores/usage');
const { Reducer } = require('./reduce');
const { MockDriver } = require('./mock');

// Chromium throttles renderers on visibility, not focus, so an always-on-top
// window that's never minimized/hidden already holds 60fps on Windows.
// These are belt-and-braces, matching webPreferences.backgroundThrottling.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(main);
}

function main() {
  const win = createPillWindow();

  const send = (state) => {
    if (process.env.USAGE_PILL_DEBUG === '1') console.log('STATE', JSON.stringify(state));
    if (!win.isDestroyed()) win.webContents.send('pill:state', state);
  };

  if (process.env.USAGE_PILL_MOCK === '1') {
    new MockDriver({ onChange: send }).start();
  } else {
    const activityStore = new ActivityStore();
    const usageStore = new UsageStore();
    const reducer = new Reducer({ activityStore, usageStore, onChange: send });
    reducer.start();
  }

  maybeConfigureLoginItem();

  app.on('window-all-closed', () => app.quit());
}

/**
 * Only wire login-on-startup once packaged: unpackaged, process.execPath is
 * node_modules\electron\dist\electron.exe, and a login entry pointing at
 * that would launch bare Electron with no app loaded.
 */
function maybeConfigureLoginItem() {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
    args: ['--hidden'],
    enabled: true,
    name: 'UsagePill',
  });
}
