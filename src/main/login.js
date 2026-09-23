'use strict';

function configureLogin(app, enabled, executable = process.execPath) {
  if (process.platform !== 'win32') throw new Error('Automatic startup requires native Windows');
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

module.exports = { configureLogin };
