'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ConfigStore, WINDOW_WIDTH, WINDOW_HEIGHT, TOP_MARGIN } = require('../src/main/stores/config');

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
