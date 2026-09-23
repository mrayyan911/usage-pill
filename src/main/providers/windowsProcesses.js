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

// Windows preserves backslashes except immediately before a quote. Splitting
// on spaces would mistake words inside prompts for utility commands.
function splitCommandLine(line) {
  const args = [];
  let token = '', quoted = false, started = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '\\') {
      let count = 1;
      while (line[i + 1] === '\\') { count++; i++; }
      if (line[i + 1] === '"') {
        token += '\\'.repeat(Math.floor(count / 2));
        i++;
        if (count % 2) token += '"';
        else quoted = !quoted;
      } else token += '\\'.repeat(count);
      started = true;
    } else if (char === '"') {
      quoted = !quoted;
      started = true;
    } else if (/\s/.test(char) && !quoted) {
      if (started) args.push(token);
      token = ''; started = false;
    } else {
      token += char;
      started = true;
    }
  }
  if (started) args.push(token);
  return args;
}

// Pure mapping from raw CIM/WMI rows to the normalized shape every provider
// produces: { name, pid, parentPid, createdAt, argv }. Split out from
// readWindowsProcesses so it's unit-testable without shelling out.
function normalizeWindowsRows(rawRows) {
  return rawRows.map(row => ({
    name: row.Name,
    pid: row.ProcessId,
    parentPid: row.ParentProcessId,
    createdAt: row.CreationDate,
    argv: row.CommandLine ? splitCommandLine(row.CommandLine) : null,
  }));
}

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
      try { resolve(normalizeWindowsRows(JSON.parse(stdout.replace(/^\uFEFF/, '')))); }
      catch { reject(new Error('Invalid Windows process snapshot')); }
    });
  });
}

module.exports = { readWindowsProcesses, normalizeWindowsRows, splitCommandLine };
