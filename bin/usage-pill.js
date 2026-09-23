#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { resolveSubcommandArgs } = require('../scripts/cliArgs');

let extraArgs;
try {
  extraArgs = resolveSubcommandArgs(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

const electron = require('electron');
const root = path.resolve(__dirname, '..');
const child = spawn(electron, [root, ...extraArgs], { windowsHide: true, stdio: 'inherit' });
child.on('error', () => { console.error('Could not launch Electron.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
