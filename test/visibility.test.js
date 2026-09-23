'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { VisibilityController } = require('../src/main/visibility');

test('automatic visibility waits for renderer readiness and the first open session', () => {
  const controller = new VisibilityController();
  controller.setSessions(['claude']);
  assert.equal(controller.snapshot().visible, false);
  controller.setReady();
  assert.equal(controller.snapshot().visible, true);
  controller.setSessions(['codex']);
  assert.equal(controller.snapshot().visible, true);
  controller.setSessions([]);
  assert.equal(controller.snapshot().visible, false);
});

test('pause persists across agent launches until resume', () => {
  const controller = new VisibilityController();
  controller.setReady();
  controller.setSessions(['claude']);
  controller.pause();
  controller.setSessions(['claude', 'codex']);
  assert.equal(controller.snapshot().visible, false);
  controller.resume();
  assert.equal(controller.snapshot().visible, true);
});

test('manual preview works without agents and resume restores automatic visibility', () => {
  const controller = new VisibilityController({ preview: true });
  controller.setReady();
  assert.equal(controller.snapshot().visible, true);
  controller.pause();
  assert.equal(controller.snapshot().visible, false);
  controller.showPreview();
  assert.equal(controller.snapshot().visible, true);
  controller.resume();
  assert.equal(controller.snapshot().visible, false);
});
