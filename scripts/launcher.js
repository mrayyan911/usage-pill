'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveSubcommandArgs } = require('./cliArgs');
const { runUpgrade, PACKAGE_NAME } = require('./upgrade');

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

function launchDetachedMonitor(electron, env) {
  const monitor = spawn(electron, [ROOT, '--monitor'], { env, cwd: ROOT, detached: true, windowsHide: true, stdio: 'ignore' });
  monitor.unref();
  return new Promise(resolve => {
    monitor.once('spawn', () => resolve(true));
    monitor.once('error', () => resolve(false));
  });
}

// Windows ships npm as npm.cmd, which Node only spawns through a shell, and
// Node deprecates passing an argument array to one. Every argument here is a
// constant or a version runUpgrade has already checked is plain digits.
function runNpm(args, { capture = false } = {}) {
  return new Promise(resolve => {
    const options = { windowsHide: true, stdio: capture ? ['ignore', 'pipe', 'ignore'] : 'inherit' };
    const child = process.platform === 'win32'
      ? spawn(['npm', ...args].join(' '), { ...options, shell: true })
      : spawn('npm', args, options);
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.on('error', () => resolve({ ok: false, output }));
    child.on('exit', code => resolve({ ok: code === 0, output }));
  });
}

function upgradeGlobalInstall(electron, env, hints) {
  return runUpgrade({
    currentVersion: require('../package.json').version,
    fetchLatestVersion: async () => {
      const { ok, output } = await runNpm(['view', PACKAGE_NAME, 'version'], { capture: true });
      if (!ok || !output.trim()) throw new Error('npm view failed');
      return output.trim();
    },
    quitRunningPill: () => new Promise(resolve => {
      // Chromium logs cache-lock noise while the old pill shuts down; the exit code is the only result.
      const child = spawn(electron, [ROOT, ...resolveSubcommandArgs('upgrade')], { env, windowsHide: true, stdio: 'ignore' });
      child.on('error', () => resolve(null));
      child.on('exit', code => resolve(code));
    }),
    installVersion: async version => (await runNpm(['install', '-g', `${PACKAGE_NAME}@${version}`])).ok,
    launchMonitor: async () => {
      // The install replaced the electron package, which may fetch its binary
      // on first load, so the path resolved before installing can be stale.
      delete require.cache[require.resolve('electron')];
      let launched = false;
      try { launched = await launchDetachedMonitor(require('electron'), env); } catch {}
      if (!launched) console.error(`The monitor could not be restarted. Run ${hints.monitor}.`);
      return launched;
    },
  });
}

// `hints` names the commands to suggest in messages, since a global install
// (`usage-pill monitor`) and a dev checkout (`npm run monitor`) spell them differently.
function runSubcommand(action, hints) {
  const extraArgs = resolveSubcommandArgs(action);
  const electron = require('electron');
  const env = launchEnv();

  if (action === 'upgrade') {
    upgradeGlobalInstall(electron, env, hints).catch(error => { console.error(error.message); process.exitCode = 1; });
    return;
  }
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
    launchDetachedMonitor(electron, env).then(launched => {
      if (launched) { console.log('Startup enabled and monitor launched. The pill appears while a claude/codex session is open; use its tray menu to pause or quit.'); return; }
      console.error(`Startup enabled, but the monitor could not start. Run ${hints.monitor}.`);
      process.exitCode = 1;
    });
  });
}

module.exports = { runSubcommand, claudeSettingsReferenceHook };
