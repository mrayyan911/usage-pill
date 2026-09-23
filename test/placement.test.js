'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createPillPlacement } = require('../src/main/placement');

function setup(t, saved = null) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const primary = { id: 1, bounds: { x: 0, y: 0, width: 1000, height: 800 }, workArea: { x: 0, y: 0, width: 1000, height: 760 } };
  const secondary = { id: 2, bounds: { x: 1000, y: 0, width: 1000, height: 800 }, workArea: { x: 1000, y: 0, width: 1000, height: 760 } };
  const screen = Object.assign(new EventEmitter(), {
    cursor: { x: -100, y: -100 },
    getPrimaryDisplay: () => primary,
    getAllDisplays: () => [primary, secondary],
    getDisplayNearestPoint: ({ x }) => x >= 1000 ? secondary : primary,
    getCursorScreenPoint() { return this.cursor; },
  });
  const positions = {
    saved,
    load() { return this.saved; },
    save(value) { this.saved = value; },
    clear() { this.saved = null; },
  };
  const placement = createPillPlacement({ screen, positions });
  return { placement, screen, positions, primary, secondary };
}

function attach(t, saved) {
  const context = setup(t, saved);
  const win = Object.assign(new EventEmitter(), {
    bounds: { ...context.placement.launchBounds },
    visible: true,
    destroyed: false,
    messages: [],
    isDestroyed() { return this.destroyed; },
    isVisible() { return this.visible; },
    getBounds() { return { ...this.bounds }; },
    setBounds(bounds) { this.bounds = { ...bounds }; this.emit('move'); },
    webContents: new EventEmitter(),
  });
  win.webContents.send = (...args) => win.messages.push(args);
  const menu = {
    openCount: 0,
    popup({ callback }) { this.openCount++; this.dismiss = callback; },
  };
  context.placement.attach(win, onReset => {
    menu.reset = onReset;
    return menu;
  });
  t.after(() => { win.destroyed = true; win.emit('closed'); });
  return { ...context, win, menu };
}

test('shared pill restores saved bounds using the existing full-window clamp', t => {
  const { placement } = setup(t, { x: -88, y: -6, displayId: 1 });
  assert.deepEqual(placement.launchBounds, { x: 0, y: 0, width: 280, height: 102 });
});

test('reset during a shared pill drag cancels the pending save', t => {
  const { win, menu, positions } = attach(t, { x: 100, y: 100, displayId: 1 });
  win.setBounds({ x: 400, y: 200, width: 280, height: 102 });
  t.mock.timers.tick(100);
  menu.reset();
  t.mock.timers.tick(400);
  assert.deepEqual(win.getBounds(), { x: 360, y: 10, width: 280, height: 102 });
  assert.equal(positions.saved, null);
});

test('shared pill clamps the visible collapsed footprint and saves only after move silence', t => {
  const { win, positions } = attach(t);
  win.setBounds({ x: -200, y: -100, width: 280, height: 102 });
  assert.deepEqual(win.getBounds(), { x: -88, y: -6, width: 280, height: 102 });
  t.mock.timers.tick(150);
  assert.equal(positions.saved, null);
  win.setBounds({ x: -200, y: -100, width: 280, height: 102 });
  t.mock.timers.tick(199);
  assert.equal(positions.saved, null);
  t.mock.timers.tick(1);
  assert.deepEqual(positions.saved, { x: -88, y: -6, displayId: 1 });
});

test('shared pill freezes expansion through a drag and resumes hover after the drop', t => {
  const { win, screen } = attach(t);
  screen.cursor = { x: 500, y: 20 };
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true]]);
  win.setBounds({ x: -200, y: -100, width: 280, height: 102 });
  assert.deepEqual(win.getBounds(), { x: -16, y: -6, width: 280, height: 102 });
  screen.cursor = { x: 900, y: 700 };
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true]]);
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true], ['pill:hover', false]]);
});

// Common off-screen drag origin used to probe which clamp rect (collapsed
// vs expanded) is currently governing the window, across the isExpanded
// tests below.
function dragOffscreen(win) {
  win.setBounds({ x: -200, y: -100, width: 280, height: 102 });
  return win.getBounds().x;
}

test('keyboard inspection uses expanded drag bounds even before a native hover', t => {
  const { win } = attach(t);
  win.webContents.emit('ipc-message', {}, 'pill:expanded', true);
  assert.equal(dragOffscreen(win), -16);
  win.webContents.emit('ipc-message', {}, 'pill:expanded', false);
  assert.equal(dragOffscreen(win), -88);
});

test('a non-boolean pill:expanded payload is ignored, keeping the last valid value', t => {
  const { win } = attach(t);
  win.webContents.emit('ipc-message', {}, 'pill:expanded', true);
  win.webContents.emit('ipc-message', {}, 'pill:expanded', 'yes');
  assert.equal(dragOffscreen(win), -16);
});

test('a keyboard-inspecting card corrects the hover poll\'s optimistic collapse guess', t => {
  const { win, screen } = attach(t);
  screen.cursor = { x: 500, y: 20 };
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true]]);
  // Keyboard inspection is independently keeping the renderer's card
  // expanded -- mirrors the real onInspect()+updateExpansion() reply.
  win.webContents.emit('ipc-message', {}, 'pill:expanded', true);
  screen.cursor = { x: -100, y: -100 };
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true], ['pill:hover', false]]);
  // The hover poll's optimistic guess just (wrongly) set isExpanded false --
  // dragging now clamps against the collapsed rect until corrected.
  assert.equal(dragOffscreen(win), -88);
  // The renderer's own updateExpansion() reply corrects it within the tick.
  win.webContents.emit('ipc-message', {}, 'pill:expanded', true);
  assert.equal(dragOffscreen(win), -16);
});

test('shared pill preserves expansion at an edge without moving its window', t => {
  const { win, screen } = attach(t);
  win.setBounds({ x: -88, y: -6, width: 280, height: 102 });
  t.mock.timers.tick(300);
  screen.cursor = { x: 20, y: 10 };
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true]]);
  assert.deepEqual(win.getBounds(), { x: -88, y: -6, width: 280, height: 102 });
});

test('shared pill gates renderer menus by its footprint and freezes hover while either menu is open', t => {
  const { win, screen, menu } = attach(t);
  win.webContents.emit('context-menu', {}, { x: 0, y: 0 });
  assert.equal(menu.openCount, 0);
  win.webContents.emit('context-menu', {}, { x: 140, y: 20 });
  assert.equal(menu.openCount, 1);
  let prevented = false;
  const nativeMenuEvent = { preventDefault() { prevented = true; } };
  win.emit('system-context-menu', nativeMenuEvent);
  assert.equal(prevented, true);
  assert.equal(menu.openCount, 1);
  screen.cursor = { x: 500, y: 20 };
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, []);
  menu.dismiss();
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true]]);
  win.emit('system-context-menu', nativeMenuEvent);
  assert.equal(menu.openCount, 2);
  screen.cursor = { x: -100, y: -100 };
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true]]);
  menu.dismiss();
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true], ['pill:hover', false]]);
});

test('shared pill gates the context menu by the expanded footprint when keyboard-inspecting without any hover', t => {
  const { win, menu } = attach(t);
  // Inside the larger expanded rect but outside the small collapsed one.
  win.webContents.emit('context-menu', {}, { x: 50, y: 20 });
  assert.equal(menu.openCount, 0);
  win.webContents.emit('ipc-message', {}, 'pill:expanded', true);
  win.webContents.emit('context-menu', {}, { x: 50, y: 20 });
  assert.equal(menu.openCount, 1);
});

test('shared pill ignores hover while hidden', t => {
  const { win, screen } = attach(t);
  win.visible = false;
  screen.cursor = { x: 500, y: 20 };
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, []);
  win.visible = true;
  t.mock.timers.tick(150);
  assert.deepEqual(win.messages, [['pill:hover', true]]);
});

test('unrelated display changes leave a dragged shared pill untouched', t => {
  const { win, screen, secondary } = attach(t);
  win.setBounds({ x: -88, y: -6, width: 280, height: 102 });
  t.mock.timers.tick(200);
  screen.emit('display-added', {}, secondary);
  screen.emit('display-metrics-changed', {}, secondary);
  screen.emit('display-removed', {}, secondary);
  assert.deepEqual(win.getBounds(), { x: -88, y: -6, width: 280, height: 102 });
});

test('work-area changes reclamp the shared pill without treating the correction as a drag', t => {
  const { win, screen, primary, positions } = attach(t);
  win.setBounds({ x: 700, y: 600, width: 280, height: 102 });
  t.mock.timers.tick(200);
  primary.workArea = { x: 0, y: 0, width: 800, height: 600 };
  screen.emit('display-metrics-changed', {}, primary);
  t.mock.timers.tick(200);
  assert.deepEqual(win.getBounds(), { x: 608, y: 558, width: 280, height: 102 });
  assert.deepEqual(positions.saved, { x: 700, y: 600, displayId: 1 });
});

test('removing the shared pill display restores the new primary and cancels a pending drag save', t => {
  const saved = { x: 100, y: 100, displayId: 1 };
  const { win, screen, primary, secondary, positions } = attach(t, saved);
  win.setBounds({ x: 200, y: 200, width: 280, height: 102 });
  screen.getPrimaryDisplay = () => secondary;
  screen.emit('display-removed', {}, primary);
  t.mock.timers.tick(300);
  assert.deepEqual(win.getBounds(), { x: 1360, y: 10, width: 280, height: 102 });
  assert.deepEqual(positions.saved, saved);
});

test('closing the shared pill cancels saves and removes only its own subscriptions', t => {
  const { win, screen, positions, menu } = attach(t);
  const unrelated = () => {};
  screen.on('display-removed', unrelated);
  win.setBounds({ x: 200, y: 200, width: 280, height: 102 });
  win.destroyed = true;
  win.emit('closed');
  win.isDestroyed = () => { throw new Error('placement timer survived window closure'); };
  t.mock.timers.tick(1000);
  assert.equal(positions.saved, null);
  assert.deepEqual(screen.listeners('display-removed'), [unrelated]);
  assert.equal(screen.listenerCount('display-metrics-changed'), 0);
  assert.equal(win.listenerCount('move'), 0);
  assert.equal(win.listenerCount('system-context-menu'), 0);
  assert.equal(win.webContents.listenerCount('context-menu'), 0);
  assert.equal(win.webContents.listenerCount('ipc-message'), 0);
  assert.equal(menu.openCount, 0);
});
