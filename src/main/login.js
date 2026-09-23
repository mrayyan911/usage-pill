'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAC_LAUNCH_AGENT_LABEL = 'com.usagepill.monitor';
const LINUX_DESKTOP_ENTRY_NAME = 'usage-pill.desktop';

function loginArgs(app) {
  return app.isPackaged ? ['--monitor'] : [app.getAppPath(), '--monitor'];
}

function configureWindowsLogin(app, enabled, executable) {
  const args = app.isPackaged ? ['--monitor'] : [`"${app.getAppPath()}"`, '--monitor'];
  const settings = { name: 'UsagePill', path: executable, args, openAtLogin: enabled, enabled };
  app.setLoginItemSettings(settings);
  // getLoginItemSettings({path, args}).openAtLogin resolves identity by the
  // app's AppUserModelID, not the custom `name` above, so it never reflects
  // this registration. launchItems lists every registered entry by name.
  const matching = app.getLoginItemSettings().launchItems.filter(item => item.name === 'UsagePill' && item.path === executable);
  const verified = enabled ? matching.some(item => item.enabled) : matching.every(item => !item.enabled);
  if (!verified) throw new Error('Windows startup registration could not be verified');
}

function escapePlistString(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function macLaunchAgentPath(homedir) {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${MAC_LAUNCH_AGENT_LABEL}.plist`);
}

function macLaunchAgentContents(executable, args) {
  const argStrings = [executable, ...args].map(value => `        <string>${escapePlistString(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
    <dict>
        <key>Label</key>
        <string>${MAC_LAUNCH_AGENT_LABEL}</string>
        <key>ProgramArguments</key>
        <array>
${argStrings}
        </array>
        <key>RunAtLoad</key>
        <true/>
    </dict>
</plist>
`;
}

// Electron's setLoginItemSettings only accepts `path`/`args`/`name` on
// Windows -- on macOS it can only toggle whether the app's own (signed,
// notarized) bundle relaunches itself, which can't target our unpackaged
// executable+args. Writing the LaunchAgent plist directly, the same way the
// Linux path below writes an XDG autostart file, is the only way to register
// an arbitrary command without code signing.
function configureMacLogin(app, enabled, executable, homedir) {
  const filePath = macLaunchAgentPath(homedir);
  if (!enabled) {
    fs.rmSync(filePath, { force: true });
    if (fs.existsSync(filePath)) throw new Error('macOS startup removal could not be verified');
    return;
  }
  const contents = macLaunchAgentContents(executable, loginArgs(app));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  if (fs.readFileSync(filePath, 'utf8') !== contents) {
    throw new Error('macOS startup registration could not be verified');
  }
}

function linuxAutostartPath(homedir, env) {
  const configHome = env.XDG_CONFIG_HOME || path.join(homedir(), '.config');
  return path.join(configHome, 'autostart', LINUX_DESKTOP_ENTRY_NAME);
}

function linuxDesktopEntryContents(executable, args) {
  const exec = [executable, ...args].join(' ');
  return `[Desktop Entry]
Type=Application
Name=Usage Pill
Exec=${exec}
X-GNOME-Autostart-enabled=true
Hidden=false
`;
}

function configureLinuxLogin(app, enabled, executable, homedir, env) {
  const filePath = linuxAutostartPath(homedir, env);
  if (!enabled) {
    fs.rmSync(filePath, { force: true });
    if (fs.existsSync(filePath)) throw new Error('Linux startup removal could not be verified');
    return;
  }
  const contents = linuxDesktopEntryContents(executable, loginArgs(app));
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  if (fs.readFileSync(filePath, 'utf8') !== contents) {
    throw new Error('Linux startup registration could not be verified');
  }
}

function configureLogin(app, enabled, executable = process.execPath, platform = process.platform, deps = {}) {
  const homedir = deps.homedir || os.homedir;
  const env = deps.env || process.env;
  if (platform === 'win32') return configureWindowsLogin(app, enabled, executable);
  if (platform === 'darwin') return configureMacLogin(app, enabled, executable, homedir);
  if (platform === 'linux') return configureLinuxLogin(app, enabled, executable, homedir, env);
  throw new Error(`Automatic startup is not supported on ${platform}`);
}

module.exports = { configureLogin };
