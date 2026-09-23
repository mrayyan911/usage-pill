'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// tray.js requires('electron') directly (there's no injectable adapter), so
// it's loaded here the same way startup.test.js loads index.js: run its
// source in a sandbox with a fake 'electron' module rather than needing a
// real Tray/Menu, which the system tray API can't provide headlessly.
function loadCreateTray() {
  let template;
  const trayInstance = { setToolTip() {}, setContextMenu(menu) { template = menu; }, destroy() {} };
  const electron = {
    Tray: class { constructor() { return trayInstance; } },
    Menu: { buildFromTemplate: (items) => items },
    nativeImage: { createFromBitmap: () => ({}) },
  };
  const moduleObj = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/main/tray'), 'utf8'), {
    require: name => { if (name === 'electron') return electron; throw new Error(`Unexpected import ${name}`); },
    module: moduleObj, exports: moduleObj.exports, process, Buffer,
  });
  return { createTray: moduleObj.exports.createTray, getTemplate: () => template };
}

test('tray "Show usage details" entry calls the inspect callback', () => {
  const { createTray, getTemplate } = loadCreateTray();
  const controller = { snapshot: () => ({ paused: false, preview: false }) };
  let inspected = false;
  createTray(controller, () => {}, () => { inspected = true; });
  const item = getTemplate().find(entry => entry.label === 'Show usage details');
  assert.ok(item, 'expected a "Show usage details" menu entry');
  item.click();
  assert.equal(inspected, true);
});

test('tray Pause/Resume click their controller methods and re-enable symmetrically after update()', () => {
  const { createTray, getTemplate } = loadCreateTray();
  let paused = false;
  const controller = {
    snapshot: () => ({ paused, preview: false }),
    pause() { paused = true; },
    resume() { paused = false; },
  };
  const { update } = createTray(controller, () => {}, () => {});

  const pauseItem = () => getTemplate().find(entry => entry.label === 'Pause automatic display');
  const resumeItem = () => getTemplate().find(entry => entry.label === 'Resume');

  assert.equal(pauseItem().enabled, true);
  assert.equal(resumeItem().enabled, false);

  pauseItem().click();
  assert.equal(paused, true);
  update();
  assert.equal(pauseItem().enabled, false);
  assert.equal(resumeItem().enabled, true);

  resumeItem().click();
  assert.equal(paused, false);
  update();
  assert.equal(pauseItem().enabled, true);
  assert.equal(resumeItem().enabled, false);
});

test('tray menu still wires pause/resume/preview/quit alongside the new entry', () => {
  const { createTray, getTemplate } = loadCreateTray();
  let paused = false;
  const controller = { snapshot: () => ({ paused, preview: false }), pause() { paused = true; }, resume() { paused = false; }, showPreview() {} };
  let quit = false;
  createTray(controller, () => { quit = true; }, () => {});
  // Array.from (the outer realm's) re-materializes the vm-sandbox array as a
  // native one, since cross-realm arrays otherwise fail assert's strict
  // reference-equality check on the Array constructor itself.
  const labels = Array.from(getTemplate(), entry => entry.label).filter(Boolean);
  assert.deepEqual(labels, ['Pause automatic display', 'Resume', 'Show preview', 'Show usage details', 'Quit']);
  getTemplate().find(entry => entry.label === 'Quit').click();
  assert.equal(quit, true);
});
