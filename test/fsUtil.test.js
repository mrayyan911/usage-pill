'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { newestFileIn } = require('../src/main/fsUtil');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-pill-fsutil-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function touch(filePath, mtime) {
  fs.writeFileSync(filePath, '');
  fs.utimesSync(filePath, mtime, mtime);
}

test('newestFileIn: returns the most-recently-modified matching file', () => {
  withTempDir((dir) => {
    touch(path.join(dir, 'a.jsonl'), new Date(2026, 0, 1));
    touch(path.join(dir, 'b.jsonl'), new Date(2026, 0, 3));
    touch(path.join(dir, 'c.jsonl'), new Date(2026, 0, 2));

    const result = newestFileIn(dir, { suffix: '.jsonl' });
    assert.equal(result.filePath, path.join(dir, 'b.jsonl'));
    assert.equal(typeof result.mtimeMs, 'number');
  });
});

test('newestFileIn: ignores subdirectories even when their name matches the suffix', () => {
  // A directory literally named "*.jsonl" must never be returned as a
  // candidate file -- this is the bug the old hand-rolled scan in
  // claudeActivity.js had (no isFile() guard) before it was switched to
  // reuse this helper.
  withTempDir((dir) => {
    fs.mkdirSync(path.join(dir, 'newer.jsonl'));
    fs.utimesSync(path.join(dir, 'newer.jsonl'), new Date(2026, 0, 5), new Date(2026, 0, 5));
    touch(path.join(dir, 'real.jsonl'), new Date(2026, 0, 1));

    const result = newestFileIn(dir, { suffix: '.jsonl' });
    assert.equal(result.filePath, path.join(dir, 'real.jsonl'));
  });
});

test('newestFileIn: filters by prefix and suffix together', () => {
  withTempDir((dir) => {
    touch(path.join(dir, 'rollout-a.jsonl'), new Date(2026, 0, 1));
    touch(path.join(dir, 'other-b.jsonl'), new Date(2026, 0, 3));

    const result = newestFileIn(dir, { prefix: 'rollout-', suffix: '.jsonl' });
    assert.equal(result.filePath, path.join(dir, 'rollout-a.jsonl'));
  });
});

test('newestFileIn: no matching files -> null', () => {
  withTempDir((dir) => {
    touch(path.join(dir, 'note.txt'), new Date(2026, 0, 1));
    assert.equal(newestFileIn(dir, { suffix: '.jsonl' }), null);
  });
});

test('newestFileIn: missing directory -> null, does not throw', () => {
  assert.doesNotThrow(() => {
    const result = newestFileIn(path.join(os.tmpdir(), 'usage-pill-does-not-exist'), { suffix: '.jsonl' });
    assert.equal(result, null);
  });
});
