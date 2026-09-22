'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigStore, WINDOW_WIDTH, WINDOW_HEIGHT, TOP_MARGIN } = require('../src/main/stores/config');

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
