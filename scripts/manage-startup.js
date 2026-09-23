'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

if (process.platform !== 'win32') {
  console.error('Automatic startup currently supports native Windows only.');
  process.exit(1);
}
const action = process.argv[2];
if (!['setup', 'remove'].includes(action)) {
  console.error('Use npm run setup or npm run setup:remove.');
  process.exit(1);
}

const electron = require('electron');
const root = path.resolve(__dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.USAGE_PILL_MOCK;
const child = spawn(electron, [root, action === 'setup' ? '--setup' : '--remove-startup'], { env, windowsHide: true, stdio: 'inherit' });
child.on('error', () => { console.error('Could not launch Electron. Run npm install first.'); process.exitCode = 1; });
child.on('exit', code => {
  if (code !== 0) { process.exitCode = code || 1; return; }
  if (action === 'remove') {
    console.log('Login startup disabled. Use Quit in the tray to stop the current monitor.');
    return;
  }
  const monitor = spawn(electron, [root, '--monitor'], { env, cwd: root, detached: true, windowsHide: true, stdio: 'ignore' });
  monitor.on('error', () => { console.error('Startup enabled, but the monitor could not start. Run npm run monitor.'); process.exitCode = 1; });
  monitor.on('spawn', () => console.log('Startup enabled and monitor launched. Use the Usage Pill tray menu to pause or quit.'));
  monitor.unref();
});
