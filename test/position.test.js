'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PositionStore, positionFilePath } = require('../src/main/stores/position');

function withTempLocalAppData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-pill-position-'));
  const previous = process.env.LOCALAPPDATA;
  process.env.LOCALAPPDATA = dir;
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA;
    else process.env.LOCALAPPDATA = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('position: file path lives under LOCALAPPDATA/usage-pill, matching activity.jsonl\'s convention', () => {
  withTempLocalAppData((dir) => {
    assert.equal(positionFilePath(), path.join(dir, 'usage-pill', 'position.json'));
  });
});

test('position: load returns null when no position has ever been saved', () => {
  withTempLocalAppData(() => {
    assert.equal(PositionStore.load(), null);
  });
});

test('position: save then load round-trips x, y, and displayId', () => {
  withTempLocalAppData(() => {
    PositionStore.save({ x: 123, y: 45, displayId: 7 });
    assert.deepEqual(PositionStore.load(), { x: 123, y: 45, displayId: 7 });
  });
});

test('position: save creates the usage-pill directory when it does not exist yet', () => {
  withTempLocalAppData((dir) => {
    assert.equal(fs.existsSync(path.join(dir, 'usage-pill')), false);
    PositionStore.save({ x: 0, y: 0, displayId: 1 });
    assert.equal(fs.existsSync(path.join(dir, 'usage-pill')), true);
  });
});

test('position: a later save overwrites the earlier one', () => {
  withTempLocalAppData(() => {
    PositionStore.save({ x: 1, y: 1, displayId: 1 });
    PositionStore.save({ x: 2, y: 2, displayId: 2 });
    assert.deepEqual(PositionStore.load(), { x: 2, y: 2, displayId: 2 });
  });
});

test('position: load tolerates a corrupt (non-JSON) file rather than throwing', () => {
  withTempLocalAppData((dir) => {
    fs.mkdirSync(path.join(dir, 'usage-pill'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'usage-pill', 'position.json'), 'not json{');
    assert.equal(PositionStore.load(), null);
  });
});

test('position: load tolerates a file missing required fields rather than throwing', () => {
  withTempLocalAppData((dir) => {
    fs.mkdirSync(path.join(dir, 'usage-pill'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'usage-pill', 'position.json'), JSON.stringify({ x: 5 }));
    assert.equal(PositionStore.load(), null);
  });
});
