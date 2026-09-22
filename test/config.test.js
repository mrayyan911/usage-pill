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

test('config: fixed position anchors top-center of the primary display', () => {
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
