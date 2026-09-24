'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { appDataDir, removeAppData } = require('../src/main/appData');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'usage-pill-appdata-'));
}

test('app data lives under LOCALAPPDATA, then APPDATA, then the home directory', () => {
  assert.equal(appDataDir({ LOCALAPPDATA: 'L', APPDATA: 'A' }, () => 'H'), path.join('L', 'usage-pill'));
  assert.equal(appDataDir({ APPDATA: 'A' }, () => 'H'), path.join('A', 'usage-pill'));
  assert.equal(appDataDir({}, () => 'H'), path.join('H', 'usage-pill'));
});

test('removing app data deletes the app files and the now-empty folder', () => {
  const dir = path.join(tempDir(), 'usage-pill');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'activity.jsonl'), '{}\n');
  fs.writeFileSync(path.join(dir, 'position.json'), '{}');
  removeAppData(dir);
  assert.equal(fs.existsSync(dir), false);
});

test('removing app data never deletes files the app did not write', () => {
  const dir = path.join(tempDir(), 'usage-pill');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'activity.jsonl'), '{}\n');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  removeAppData(dir);
  assert.equal(fs.existsSync(path.join(dir, 'activity.jsonl')), false);
  assert.equal(fs.existsSync(path.join(dir, 'package.json')), true);
});

test('removing app data that was never created is a no-op', () => {
  assert.doesNotThrow(() => removeAppData(path.join(tempDir(), 'usage-pill')));
});
