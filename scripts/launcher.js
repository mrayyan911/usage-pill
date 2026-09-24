'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveSubcommandArgs } = require('./cliArgs');

const ROOT = path.resolve(__dirname, '..');

function claudeSettingsReferenceHook(homedir = os.homedir) {
  try { return fs.readFileSync(path.join(homedir(), '.claude', 'settings.json'), 'utf8').includes('activity-hook.js'); }
  catch { return false; }
}

function launchEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.USAGE_PILL_MOCK;
  return env;
}

// `hints` names the commands to suggest in messages, since a global install
// (`usage-pill monitor`) and a dev checkout (`npm run monitor`) spell them differently.
function runSubcommand(action, hints) {
  const extraArgs = resolveSubcommandArgs(action);
  const electron = require('electron');
  const env = launchEnv();

  if (action === undefined) console.log(`Tip: run \`${hints.setup}\` to start hidden at login and appear only while a claude/codex session is open.`);

  const child = spawn(electron, [ROOT, ...extraArgs], { env, windowsHide: true, stdio: 'inherit' });
  child.on('error', () => { console.error('Could not launch Electron.'); process.exitCode = 1; });
  child.on('exit', code => {
    if (code !== 0) { process.exitCode = code ?? 1; return; }
    if (action === undefined || action === 'monitor') return;
    if (action === 'setup:remove') {
      console.log('Login startup disabled. Use Quit in the tray to stop the current monitor.');
      return;
    }
    if (action === 'uninstall') {
      console.log('Login startup entry removed and local data deleted. A running pill was told to quit; if one is still on screen, use Quit in its tray menu.');
      if (claudeSettingsReferenceHook()) {
        console.log('Your ~/.claude/settings.json still references activity-hook.js; remove those hook entries by hand.');
      }
      if (hints.removePackage) console.log(`To finish, run: ${hints.removePackage}`);
      return;
    }
    const monitor = spawn(electron, [ROOT, '--monitor'], { env, cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' });
    monitor.on('error', () => { console.error(`Startup enabled, but the monitor could not start. Run ${hints.monitor}.`); process.exitCode = 1; });
    monitor.on('spawn', () => console.log('Startup enabled and monitor launched. The pill appears while a claude/codex session is open; use its tray menu to pause or quit.'));
    monitor.unref();
  });
}

module.exports = { runSubcommand, claudeSettingsReferenceHook };
