'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const quitResult = require('../src/main/quitResult');

const ROOT = path.resolve(__dirname, '..');

test('--quit stops a real running monitor, then reports that none is running', { timeout: 60_000 }, async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pill-quit-test-'));
  const env = { ...process.env, LOCALAPPDATA: profile, APPDATA: profile, USAGE_PILL_DEBUG: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  // The single-instance lock is scoped to the profile, so this never touches
  // a pill the developer has running.
  const args = extra => [ROOT, extra, `--user-data-dir=${profile}`];
  const monitor = spawn(require('electron'), args('--monitor'), { env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const exited = new Promise(resolve => monitor.on('exit', resolve));
  try {
    // Session polling only starts after the lock is held.
    await new Promise((resolve, reject) => {
      monitor.stdout.on('data', chunk => { if (String(chunk).includes('SESSIONS')) resolve(); });
      monitor.on('exit', () => reject(new Error('monitor exited before it was ready')));
    });
    const quit = () => spawnSync(require('electron'), args('--quit'), { env, windowsHide: true, timeout: 30_000 });
    assert.equal(quit().status, quitResult.STOPPED);
    await exited;
    assert.equal(quit().status, quitResult.NOT_RUNNING);
  } finally {
    monitor.kill();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
