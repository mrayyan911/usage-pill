'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function runElectron(script, timeout = 30_000) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pill-electron-test-'));
  const env = { ...process.env, LOCALAPPDATA: profile, APPDATA: profile };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    // Shared Chromium profiles inherit user zoom and race for the disk cache.
    return spawnSync(require('electron'), [path.join(__dirname, script), `--user-data-dir=${profile}`], {
      env, encoding: 'utf8', windowsHide: true, timeout,
    });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

module.exports = { runElectron };
