'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const APP_DATA_FILES = ['activity.jsonl', 'position.json'];

function appDataDir(env = process.env, homedir = os.homedir) {
  const base = env.LOCALAPPDATA || env.APPDATA || homedir();
  return path.join(base, 'usage-pill');
}

// Off Windows the base falls back to the home directory, so the folder is
// ~/usage-pill -- a name a user may well have used for a checkout of this
// repo. Only delete the files the app itself writes, and the folder only
// once that leaves it empty.
function removeAppData(dir = appDataDir()) {
  for (const name of APP_DATA_FILES) fs.rmSync(path.join(dir, name), { force: true });
  try { fs.rmdirSync(dir); } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTEMPTY' && error.code !== 'EEXIST') throw error;
  }
}

module.exports = { appDataDir, removeAppData };
