'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ConfigStore,
  WINDOW_WIDTH,
  WINDOW_HEIGHT,
  TOP_MARGIN,
  PILL_WIDTH,
  PILL_HEIGHT,
  PILL_EXPANDED_WIDTH,
  PILL_EXPANDED_HEIGHT,
  PILL_TOP_OFFSET,
} = require('../src/main/stores/config');

const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };

test('config: default launch position anchors top-center of the primary display', () => {
  const result = ConfigStore.topCenterBounds(PRIMARY);
  assert.equal(result.x, Math.round((1920 - WINDOW_WIDTH) / 2));
  assert.equal(result.y, TOP_MARGIN);
  assert.equal(result.width, WINDOW_WIDTH);
  assert.equal(result.height, WINDOW_HEIGHT);
});

test('config: top-center bounds re-derive from whichever display is primary (monitor hotplug safe)', () => {
  const secondary = { workArea: { x: 1920, y: 0, width: 2560, height: 1440 } };
  const result = ConfigStore.topCenterBounds(secondary);
  assert.equal(result.x, 1920 + Math.round((2560 - WINDOW_WIDTH) / 2));
  assert.equal(result.y, TOP_MARGIN);
});

test('config: clampToWorkArea leaves an in-bounds drag position unchanged', () => {
  const bounds = { x: 500, y: 300, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  const result = ConfigStore.clampToWorkArea(bounds, PRIMARY.workArea);
  assert.deepEqual(result, bounds);
});

test('config: clampToWorkArea hard-stops at the right/bottom edge, no overshoot', () => {
  const bounds = { x: 1900, y: 1030, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  const result = ConfigStore.clampToWorkArea(bounds, PRIMARY.workArea);
  assert.equal(result.x, PRIMARY.workArea.x + PRIMARY.workArea.width - WINDOW_WIDTH);
  assert.equal(result.y, PRIMARY.workArea.y + PRIMARY.workArea.height - WINDOW_HEIGHT);
});

test('config: clampToWorkArea hard-stops at the left/top edge, no overshoot', () => {
  const bounds = { x: -50, y: -20, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  const result = ConfigStore.clampToWorkArea(bounds, PRIMARY.workArea);
  assert.equal(result.x, PRIMARY.workArea.x);
  assert.equal(result.y, PRIMARY.workArea.y);
});

test('config: clampToWorkArea clamps against a non-primary display\'s own work area (monitor hotplug safe)', () => {
  const secondary = { x: 1920, y: 0, width: 2560, height: 1440 };
  const bounds = { x: 1920 - 10, y: 700, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  const result = ConfigStore.clampToWorkArea(bounds, secondary);
  assert.equal(result.x, secondary.x);
  assert.equal(result.y, 700);
});

test('config: clampToWorkArea pins to the work-area origin when the window is larger than the display', () => {
  const tinyWorkArea = { x: 100, y: 50, width: 200, height: 60 };
  const bounds = { x: 250, y: 180, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  const result = ConfigStore.clampToWorkArea(bounds, tinyWorkArea);
  assert.equal(result.x, tinyWorkArea.x);
  assert.equal(result.y, tinyWorkArea.y);
});

test('config: collapsed pill hit rect is much smaller than the pre-sized OS window', () => {
  const windowBounds = ConfigStore.topCenterBounds(PRIMARY);
  const rect = ConfigStore.pillHitRect(windowBounds, { expanded: false });
  assert.equal(rect.width, PILL_WIDTH);
  assert.equal(rect.height, PILL_HEIGHT);
  assert.equal(rect.x, windowBounds.x + Math.round((windowBounds.width - PILL_WIDTH) / 2));
  assert.equal(rect.y, windowBounds.y + PILL_TOP_OFFSET);
  // The whole point: a cursor inside the window but outside the collapsed
  // pill (e.g. its horizontal padding) must not land inside this rect.
  assert.ok(rect.x > windowBounds.x);
  assert.ok(rect.width < windowBounds.width);
  assert.ok(rect.height < windowBounds.height);
});

test('config: expanded pill hit rect matches the expanded footprint, still smaller than the window', () => {
  const windowBounds = ConfigStore.topCenterBounds(PRIMARY);
  const rect = ConfigStore.pillHitRect(windowBounds, { expanded: true });
  assert.equal(rect.width, PILL_EXPANDED_WIDTH);
  assert.equal(rect.height, PILL_EXPANDED_HEIGHT);
  assert.equal(rect.x, windowBounds.x + Math.round((windowBounds.width - PILL_EXPANDED_WIDTH) / 2));
  assert.equal(rect.y, windowBounds.y + PILL_TOP_OFFSET);
  assert.ok(rect.width < windowBounds.width);
  assert.ok(rect.height < windowBounds.height);
});

test('config: clampWindowToVisiblePill leaves the window alone when the visible pill is already in bounds', () => {
  const windowBounds = { x: 500, y: 300, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  const result = ConfigStore.clampWindowToVisiblePill(windowBounds, PRIMARY.workArea, { expanded: false });
  assert.deepEqual(result, windowBounds);
});

test('config: clampWindowToVisiblePill hard-stops the small collapsed pill at the edge, not the larger invisible window', () => {
  // Drag the window bounds well past the right/bottom edge.
  const windowBounds = { x: 1900, y: 1030, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  const result = ConfigStore.clampWindowToVisiblePill(windowBounds, PRIMARY.workArea, { expanded: false });
  const resultRect = ConfigStore.pillHitRect(result, { expanded: false });
  // The *visible collapsed pill*, not the window, must sit flush with the work area.
  assert.equal(resultRect.x + resultRect.width, PRIMARY.workArea.x + PRIMARY.workArea.width);
  assert.equal(resultRect.y + resultRect.height, PRIMARY.workArea.y + PRIMARY.workArea.height);
  // The window itself legitimately overshoots past the work area -- only the
  // visible pill inside it has to stay on-screen.
  assert.ok(result.x + result.width > PRIMARY.workArea.x + PRIMARY.workArea.width);
});

test('config: clampWindowToVisiblePill hard-stops the expanded pill at the edge', () => {
  const windowBounds = { x: -50, y: -50, width: WINDOW_WIDTH, height: WINDOW_HEIGHT };
  const result = ConfigStore.clampWindowToVisiblePill(windowBounds, PRIMARY.workArea, { expanded: true });
  const resultRect = ConfigStore.pillHitRect(result, { expanded: true });
  assert.equal(resultRect.x, PRIMARY.workArea.x);
  assert.equal(resultRect.y, PRIMARY.workArea.y);
});
