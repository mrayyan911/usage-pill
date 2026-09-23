'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { VisibilityController } = require('../src/main/visibility');

async function launch(argv = ['electron', '.','--monitor'], { loginError } = {}) {
  const app = new EventEmitter();
  let exitCode;
  Object.assign(app, { commandLine: { appendSwitch() {} }, requestSingleInstanceLock: () => true, whenReady: () => Promise.resolve(), quit() { app.emit('before-quit'); }, exit(code) { exitCode = code; } });
  const win = new EventEmitter();
  let visible = false;
  let driverRunning = false;
  const messages = [];
  Object.assign(win, { isDestroyed: () => false, isVisible: () => visible, showInactive() { visible = true; }, hide() { visible = false; }, setAlwaysOnTop() {}, webContents: Object.assign(new EventEmitter(), { send: (...args) => messages.push(args) }) });
  let updateSessions;
  let stopped = false;
  let controller;
  let setup;
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
    './tray': { createTray: value => { controller = value; return { update() {}, destroy() {} }; } },
    './login': { configureLogin: (_app, enabled) => { setup = enabled; if (loginError) throw loginError; } },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/main/index'), 'utf8'), {
    require: name => { if (name.startsWith('node:')) return require(name); if (modules[name]) return modules[name]; throw new Error(`Unexpected import ${name}`); },
    process: { argv, env: {}, platform: 'win32', exitCode: 0 }, console: { ...console, error() {} },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { app, win, messages, get visible() { return visible; }, get running() { return driverRunning; }, get stopped() { return stopped; }, get setup() { return setup; }, get controller() { return controller; }, get exitCode() { return exitCode; }, sessions: agents => updateSessions({ agents, status: 'ok' }) };
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

test('a failed setup exits non-zero instead of silently reporting success', async () => {
  const runtime = await launch(['electron', '.', '--setup'], { loginError: new Error('Windows startup registration could not be verified') });
  assert.equal(runtime.setup, true);
  assert.equal(runtime.exitCode, 1);
});
