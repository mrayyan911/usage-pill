'use strict';

const { app } = require('electron');

const { createPillWindow, ALWAYS_ON_TOP_LEVEL } = require('./window');
const { ActivityStore } = require('./stores/activity');
const { UsageStore } = require('./stores/usage');
const { SessionStore } = require('./stores/sessions');
const { Reducer } = require('./reduce');
const { MockDriver } = require('./mock');
const { VisibilityController } = require('./visibility');
const { createTray } = require('./tray');
const { configureLogin } = require('./login');

// Chromium throttles renderers on visibility, not focus, so an always-on-top
// window that's never minimized/hidden already holds 60fps on Windows.
// These are belt-and-braces, matching webPreferences.backgroundThrottling.
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const mock = process.env.USAGE_PILL_MOCK === '1';
let preview = mock || !process.argv.some(arg => arg === '--monitor' || arg === '--hidden');
let controller;

// Setup must also work while another instance owns the pill.
if (process.argv.includes('--setup') || process.argv.includes('--remove-startup')) {
  app.whenReady().then(() => {
    // app.quit() + process.exitCode is silently ignored by Electron; app.exit()
    // is the only way to make manage-startup.js see a real failure exit code.
    try { configureLogin(app, process.argv.includes('--setup')); app.exit(0); }
    catch (error) { console.error(error.message); app.exit(1); }
  });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (argv.some(arg => arg === '--monitor' || arg === '--hidden')) return;
    preview = true;
    controller?.showPreview();
  });
  app.whenReady().then(main);
}

function main() {
  if (!preview && process.platform !== 'win32') {
    console.error('Automatic display currently supports native Windows only.');
    app.quit();
    return;
  }
  const win = createPillWindow({ autoShow: false });
  const sessions = !mock && process.platform === 'win32' ? new SessionStore() : null;
  let lastState;
  let ready = false;
  let running = false;
  let tray;

  const send = (state) => {
    lastState = state;
    if (process.env.USAGE_PILL_DEBUG === '1') console.log('STATE', JSON.stringify(state));
    if (ready && !win.isDestroyed()) win.webContents.send('pill:state', state);
  };

  const driver = mock ? new MockDriver({ onChange: send }) : new Reducer({
    activityStore: new ActivityStore(), usageStore: new UsageStore(), sessionStore: sessions,
    preview: () => controller.snapshot().preview, onChange: send,
  });
  controller = new VisibilityController({ preview, onChange: state => {
    if (win.isDestroyed()) return;
    if (state.visible) {
      if (!running) { running = true; driver.start(); }
      if (!win.isVisible()) win.showInactive();
      win.setAlwaysOnTop(true, ALWAYS_ON_TOP_LEVEL);
    } else {
      if (running) { running = false; driver.stop(); }
      if (win.isVisible()) win.hide();
    }
    tray?.update();
    if (process.env.USAGE_PILL_DEBUG === '1') console.log('VISIBILITY', JSON.stringify(state));
  } });
  tray = createTray(controller, () => app.quit());
  win.once('ready-to-show', () => {
    ready = true;
    controller.setReady();
  });
  win.webContents.on('did-finish-load', () => {
    if (lastState) win.webContents.send('pill:state', lastState);
  });
  let sessionStatus;
  sessions?.start(snapshot => {
    if (snapshot.status === 'error' && sessionStatus !== 'error') console.warn('Session detection failed; retaining the last process snapshot.');
    sessionStatus = snapshot.status;
    if (process.env.USAGE_PILL_DEBUG === '1') console.log('SESSIONS', JSON.stringify(snapshot));
    controller.setSessions(snapshot.agents);
  });
  app.on('before-quit', () => {
    sessions?.stop();
    driver.stop();
    tray.destroy();
  });
  app.on('window-all-closed', () => app.quit());
}
