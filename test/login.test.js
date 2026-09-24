'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureLogin } = require('../src/main/login');

test('source setup registers the raw checkout path and monitor mode, then verifies registration', () => {
  let written;
  const app = {
    isPackaged: false,
    getAppPath: () => 'D:\\My Projects\\usage-pill',
    setLoginItemSettings: settings => { written = settings; },
    getLoginItemSettings: () => ({ launchItems: [{ name: 'UsagePill', path: 'C:\\Electron\\electron.exe', enabled: written.enabled }] }),
  };
  configureLogin(app, true, 'C:\\Electron\\electron.exe', 'win32');
  assert.equal(written.openAtLogin, true);
  assert.equal(written.name, 'UsagePill');
  assert.deepEqual(written.args, ['D:\\My Projects\\usage-pill', '--monitor']);
  configureLogin(app, false, 'C:\\Electron\\electron.exe', 'win32');
  assert.equal(written.openAtLogin, false);
});

test('packaged setup does not pass a source directory; failed registration is reported', () => {
  const app = {
    isPackaged: true,
    setLoginItemSettings: settings => assert.deepEqual(settings.args, ['--monitor']),
    getLoginItemSettings: () => ({ launchItems: [] }),
  };
  assert.throws(() => configureLogin(app, true, 'C:\\UsagePill.exe', 'win32'), /startup/i);
});

test('registration under a different identity (AppUserModelID mismatch) does not count as verified', () => {
  const app = {
    isPackaged: true,
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({ launchItems: [{ name: 'UsagePill', path: 'C:\\Other\\electron.exe', enabled: true }] }),
  };
  assert.throws(() => configureLogin(app, true, 'C:\\UsagePill.exe', 'win32'), /startup/i);
});

test('removal is verified when Windows leaves no matching launch item at all', () => {
  const app = {
    isPackaged: true,
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({ launchItems: [] }),
  };
  configureLogin(app, false, 'C:\\UsagePill.exe', 'win32');
});

test('an unsupported platform is rejected before touching any login-item API', () => {
  const app = { setLoginItemSettings: () => assert.fail('should not be called'), getLoginItemSettings: () => assert.fail('should not be called') };
  assert.throws(() => configureLogin(app, true, 'C:\\UsagePill.exe', 'freebsd'), /not supported/i);
});

function withTempHome(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-pill-login-'));
  try {
    return fn(dir, () => dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('macOS: registering writes a LaunchAgent plist naming the checkout app path and monitor mode', () => {
  withTempHome((dir, homedir) => {
    const app = { isPackaged: false, getAppPath: () => '/Users/rayyan/usage-pill' };
    configureLogin(app, true, '/Applications/UsagePill.app/Contents/MacOS/UsagePill', 'darwin', { homedir });
    const plistPath = path.join(dir, 'Library', 'LaunchAgents', 'com.usagepill.monitor.plist');
    const contents = fs.readFileSync(plistPath, 'utf8');
    assert.match(contents, /<string>\/Applications\/UsagePill\.app\/Contents\/MacOS\/UsagePill<\/string>/);
    assert.match(contents, /<string>\/Users\/rayyan\/usage-pill<\/string>/);
    assert.match(contents, /<string>--monitor<\/string>/);
  });
});

test('macOS: packaged registration omits the checkout app-path argument', () => {
  withTempHome((dir, homedir) => {
    const app = { isPackaged: true };
    configureLogin(app, true, '/Applications/UsagePill.app/Contents/MacOS/UsagePill', 'darwin', { homedir });
    const plistPath = path.join(dir, 'Library', 'LaunchAgents', 'com.usagepill.monitor.plist');
    const contents = fs.readFileSync(plistPath, 'utf8');
    assert.doesNotMatch(contents, /usage-pill<\/string>/);
  });
});

test('macOS: removing deletes the LaunchAgent plist', () => {
  withTempHome((dir, homedir) => {
    const app = { isPackaged: true };
    configureLogin(app, true, '/Applications/UsagePill.app/Contents/MacOS/UsagePill', 'darwin', { homedir });
    const plistPath = path.join(dir, 'Library', 'LaunchAgents', 'com.usagepill.monitor.plist');
    assert.equal(fs.existsSync(plistPath), true);
    configureLogin(app, false, '/Applications/UsagePill.app/Contents/MacOS/UsagePill', 'darwin', { homedir });
    assert.equal(fs.existsSync(plistPath), false);
  });
});

test('macOS: removing when never registered is a no-op, not a failure', () => {
  withTempHome((dir, homedir) => {
    const app = { isPackaged: true };
    assert.doesNotThrow(() => configureLogin(app, false, '/Applications/UsagePill.app/Contents/MacOS/UsagePill', 'darwin', { homedir }));
  });
});

test('macOS: a stale plist pointing at a different executable is corrected on re-register', () => {
  withTempHome((dir, homedir) => {
    const plistDir = path.join(dir, 'Library', 'LaunchAgents');
    fs.mkdirSync(plistDir, { recursive: true });
    const plistPath = path.join(plistDir, 'com.usagepill.monitor.plist');
    fs.writeFileSync(plistPath, '<plist><string>/old/stale/path</string></plist>');
    const app = { isPackaged: true };
    configureLogin(app, true, '/Applications/UsagePill.app/Contents/MacOS/UsagePill', 'darwin', { homedir });
    const contents = fs.readFileSync(plistPath, 'utf8');
    assert.doesNotMatch(contents, /old\/stale\/path/);
    assert.match(contents, /<string>\/Applications\/UsagePill\.app\/Contents\/MacOS\/UsagePill<\/string>/);
  });
});

test('Linux: registering writes an XDG autostart .desktop file under XDG_CONFIG_HOME', () => {
  withTempHome((dir, homedir) => {
    const configHome = path.join(dir, 'xdg-config');
    const app = { isPackaged: false, getAppPath: () => '/home/rayyan/usage-pill' };
    configureLogin(app, true, '/usr/bin/usage-pill', 'linux', { homedir, env: { XDG_CONFIG_HOME: configHome } });
    const desktopPath = path.join(configHome, 'autostart', 'usage-pill.desktop');
    const contents = fs.readFileSync(desktopPath, 'utf8');
    assert.match(contents, /^Exec=\/usr\/bin\/usage-pill \/home\/rayyan\/usage-pill --monitor$/m);
    assert.match(contents, /^Type=Application$/m);
    assert.match(contents, /^X-GNOME-Autostart-enabled=true$/m);
  });
});

test('Linux: an executable or app path containing a space is quoted in Exec, not split into two tokens', () => {
  withTempHome((dir, homedir) => {
    const configHome = path.join(dir, 'xdg-config');
    const app = { isPackaged: false, getAppPath: () => '/home/rayyan/My Projects/usage-pill' };
    configureLogin(app, true, '/usr/bin/usage-pill', 'linux', { homedir, env: { XDG_CONFIG_HOME: configHome } });
    const desktopPath = path.join(configHome, 'autostart', 'usage-pill.desktop');
    const contents = fs.readFileSync(desktopPath, 'utf8');
    assert.match(contents, /^Exec=\/usr\/bin\/usage-pill "\/home\/rayyan\/My Projects\/usage-pill" --monitor$/m);
  });
});

test('Linux: a literal percent sign in the path is doubled, not left as a field code', () => {
  withTempHome((dir, homedir) => {
    const configHome = path.join(dir, 'xdg-config');
    const app = { isPackaged: false, getAppPath: () => '/home/rayyan/100%/usage-pill' };
    configureLogin(app, true, '/usr/bin/usage-pill', 'linux', { homedir, env: { XDG_CONFIG_HOME: configHome } });
    const desktopPath = path.join(configHome, 'autostart', 'usage-pill.desktop');
    const contents = fs.readFileSync(desktopPath, 'utf8');
    assert.match(contents, /^Exec=\/usr\/bin\/usage-pill "\/home\/rayyan\/100%%\/usage-pill" --monitor$/m);
  });
});

test('Linux: registering falls back to ~/.config/autostart when XDG_CONFIG_HOME is unset', () => {
  withTempHome((dir, homedir) => {
    const app = { isPackaged: true };
    configureLogin(app, true, '/usr/bin/usage-pill', 'linux', { homedir, env: {} });
    const desktopPath = path.join(dir, '.config', 'autostart', 'usage-pill.desktop');
    assert.equal(fs.existsSync(desktopPath), true);
  });
});

test('Linux: removing deletes the .desktop file', () => {
  withTempHome((dir, homedir) => {
    const app = { isPackaged: true };
    configureLogin(app, true, '/usr/bin/usage-pill', 'linux', { homedir, env: {} });
    const desktopPath = path.join(dir, '.config', 'autostart', 'usage-pill.desktop');
    assert.equal(fs.existsSync(desktopPath), true);
    configureLogin(app, false, '/usr/bin/usage-pill', 'linux', { homedir, env: {} });
    assert.equal(fs.existsSync(desktopPath), false);
  });
});

test('Linux: removing when never registered is a no-op, not a failure', () => {
  withTempHome((dir, homedir) => {
    const app = { isPackaged: true };
    assert.doesNotThrow(() => configureLogin(app, false, '/usr/bin/usage-pill', 'linux', { homedir, env: {} }));
  });
});

test('Linux: a stale .desktop file with a different Exec path is corrected on re-register', () => {
  withTempHome((dir, homedir) => {
    const autostartDir = path.join(dir, '.config', 'autostart');
    fs.mkdirSync(autostartDir, { recursive: true });
    const desktopPath = path.join(autostartDir, 'usage-pill.desktop');
    fs.writeFileSync(desktopPath, '[Desktop Entry]\nExec=/old/stale/usage-pill --monitor\n');
    const app = { isPackaged: true };
    configureLogin(app, true, '/usr/bin/usage-pill', 'linux', { homedir, env: {} });
    const contents = fs.readFileSync(desktopPath, 'utf8');
    assert.doesNotMatch(contents, /old\/stale/);
    assert.match(contents, /^Exec=\/usr\/bin\/usage-pill --monitor$/m);
  });
});
