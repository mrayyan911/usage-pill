'use strict';

const path = require('node:path');
const { execFile } = require('node:child_process');

const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$desktopSession = [Diagnostics.Process]::GetCurrentProcess().SessionId
$rows = @(Get-CimInstance Win32_Process -Filter "SessionId=$desktopSession AND (Name='claude.exe' OR Name='codex.exe' OR Name='node.exe')" |
  Select-Object Name,ProcessId,ParentProcessId,CommandLine,@{Name='CreationDate';Expression={$_.CreationDate.ToUniversalTime().ToString('o')}})
ConvertTo-Json -InputObject $rows -Compress
`;

function readWindowsProcesses({ signal } = {}) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Session detection requires native Windows'));
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8', signal,
    }, (error, stdout) => {
      // Command lines can contain prompts or credentials; never expose them
      // through child-process errors or debug logs.
      if (error) return reject(new Error('Windows process query failed'));
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, ''))); }
      catch { reject(new Error('Invalid Windows process snapshot')); }
    });
  });
}

module.exports = { readWindowsProcesses };
