'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { VisibilityController } = require('../src/main/visibility');

async function launch(argv = ['electron', '.','--monitor'], { loginError, platform = 'win32' } = {}) {
  const app = new EventEmitter();
  let exitCode;
  Object.assign(app, { commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), quit() { quitCount += 1; app.emit('before-quit'); }, exit(code) { exitCode = code; } });
  const win = new EventEmitter();
  let visible = false;
  let focused = false;
  let destroyed = false;
  let driverRunning = false;
  const messages = [];
  Object.assign(win, { isDestroyed: () => destroyed, isVisible: () => visible, showInactive() { visible = true; }, show() { visible = true; }, focus() { focused = true; }, hide() { visible = false; }, setAlwaysOnTop() {}, webContents: Object.assign(new EventEmitter(), { send: (...args) => messages.push(args) }) });
  let updateSessions;
  let stopped = false;
  let controller;
  let setup;
  let dataRemoved = false;
  let quitCount = 0;
  let inspect;
  const modules = {
    electron: { app },
    './window': { createPillWindow: ({ autoShow } = {}) => { if (autoShow !== false) visible = true; return win; }, ALWAYS_ON_TOP_LEVEL: 'screen-saver' },
    './stores/activity': { ActivityStore: class {} },
    './stores/usage': { UsageStore: class {} },
    './stores/sessions': { SessionStore: class {
      start(callback) { updateSessions = callback; }
      stop() { stopped = true; }
    } },
    './reduce': { Reducer: class {
      constructor({ onChange }) { this.send = onChange; }
      start() { driverRunning = true; this.send({ agents: [{ agent: 'claude' }] }); }
      stop() { driverRunning = false; }
    } },
    './mock': { MockDriver: class {} },
    './visibility': { VisibilityController },
    './tray': { createTray: (value, _quit, inspectCallback) => { controller = value; inspect = inspectCallback; return { update() {}, destroy() {} }; } },
    './login': { configureLogin: (_app, enabled) => { setup = enabled; if (loginError) throw loginError; } },
    './appData': { removeAppData: () => { dataRemoved = true; } },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/main/index'), 'utf8'), {
    require: name => { if (name.startsWith('node:')) return require(name); if (modules[name]) return modules[name]; throw new Error(`Unexpected import ${name}`); },
    process: { argv, env: {}, platform, exitCode: 0 }, console: { ...console, error() {} },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { app, win, messages, get visible() { return visible; }, get focused() { return focused; }, destroy() { destroyed = true; }, get running() { return driverRunning; }, get stopped() { return stopped; }, get setup() { return setup; }, get controller() { return controller; }, get exitCode() { return exitCode; }, get dataRemoved() { return dataRemoved; }, get quitCount() { return quitCount; }, inspect: () => inspect(), sessions: agents => updateSessions({ agents, status: 'ok' }) };
}

test('monitor stays hidden until ready and a session opens; last exit stops activity polling', async () => {
  const runtime = await launch();
  runtime.win.emit('ready-to-show');
  assert.equal(runtime.visible, false);
  runtime.sessions(['claude']);
  assert.equal(runtime.visible, true);
  assert.equal(runtime.running, true);
  runtime.sessions([]);
  assert.equal(runtime.visible, false);
  assert.equal(runtime.running, false);
  runtime.app.quit();
  assert.equal(runtime.stopped, true);
});

test('monitor mode works on non-Windows platforms now that session detection is cross-platform', async () => {
  const runtime = await launch(['electron', '.', '--monitor'], { platform: 'darwin' });
  runtime.win.emit('ready-to-show');
  assert.equal(runtime.visible, false);
  runtime.sessions(['claude']);
  assert.equal(runtime.visible, true);
  assert.equal(runtime.running, true);
});

test('a second manual launch previews the existing pill; tray pause and resume restore automatic behavior', async () => {
  const runtime = await launch();
  runtime.win.emit('ready-to-show');
  runtime.app.emit('second-instance', {}, ['electron', '.']);
  assert.equal(runtime.visible, true);
  runtime.controller.pause();
  assert.equal(runtime.visible, false);
  runtime.sessions(['codex']);
  assert.equal(runtime.visible, false);
  runtime.controller.resume();
  assert.equal(runtime.visible, true);
});

test('setup removal configures login without starting a monitor', async () => {
  const runtime = await launch(['electron', '.', '--remove-startup']);
  assert.equal(runtime.setup, false);
  assert.equal(runtime.controller, undefined);
  assert.equal(runtime.exitCode, 0);
});

test('uninstall removes the login item and app data without starting a monitor', async () => {
  const runtime = await launch(['electron', '.', '--uninstall']);
  assert.equal(runtime.setup, false);
  assert.equal(runtime.dataRemoved, true);
  assert.equal(runtime.controller, undefined);
  assert.equal(runtime.exitCode, 0);
});

test('a failed uninstall exits non-zero and leaves app data in place', async () => {
  const runtime = await launch(['electron', '.', '--uninstall'], { loginError: new Error('Windows startup registration could not be verified') });
  assert.equal(runtime.dataRemoved, false);
  assert.equal(runtime.exitCode, 1);
});

test('a running monitor quits when an uninstall is launched', async () => {
  const runtime = await launch();
  runtime.win.emit('ready-to-show');
  runtime.app.emit('second-instance', {}, ['electron', '.', '--uninstall']);
  assert.equal(runtime.quitCount, 1);
  assert.equal(runtime.stopped, true);
});

test('a failed setup exits non-zero instead of silently reporting success', async () => {
  const runtime = await launch(['electron', '.', '--setup'], { loginError: new Error('Windows startup registration could not be verified') });
  assert.equal(runtime.setup, true);
  assert.equal(runtime.exitCode, 1);
});

test('the tray\'s "Show usage details" entry previews, focuses the window, and tells the renderer to focus a badge', async () => {
  const runtime = await launch();
  runtime.win.emit('ready-to-show');
  assert.equal(runtime.visible, false);
  runtime.inspect();
  assert.equal(runtime.visible, true);
  assert.equal(runtime.focused, true);
  assert.deepEqual(runtime.messages.at(-1), ['pill:inspect']);
});

test('the tray\'s "Show usage details" entry is a no-op once the window is destroyed', async () => {
  const runtime = await launch();
  runtime.win.emit('ready-to-show');
  runtime.destroy();
  assert.doesNotThrow(() => runtime.inspect());
  assert.equal(runtime.visible, false);
  assert.equal(runtime.focused, false);
});
