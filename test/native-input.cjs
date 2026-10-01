'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { app, BrowserWindow, screen } = require('electron');
const { createPillWindow } = require('../src/main/window');

app.whenReady().then(async () => {
  let win;
  // Keep unrelated desktop windows below the target; the pill uses a higher level.
  const background = new BrowserWindow({ x: 200, y: 200, width: 600, height: 300, frame: false, alwaysOnTop: true });
  const originalCursor = screen.getCursorScreenPoint();
  let exitCode = 0;
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const artifacts = path.join(__dirname, '../docs/qa/bugs');
  fs.mkdirSync(artifacts, { recursive: true });
  const mouse = async (point, action = 'move') => {
    const physical = screen.dipToScreenPoint({ x: Math.round(point.x), y: Math.round(point.y) });
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, 'native-input.ps1'), '-X', String(physical.x), '-Y', String(physical.y), '-Action', action,
      '-EndX', String(physical.x + 80), '-EndY', String(physical.y + 60)],
    { windowsHide: true, timeout: 10_000 });
  };
  try {
    await background.loadURL('data:text/html,<body style="background:%23273748;color:white">Native input QA target<script>window.clicks=0;document.addEventListener("click",()=>window.clicks++)</script>');
    background.show();
    background.focus();
    await mouse({ x: 220, y: 400 }, 'click');
    await pause(200);
    assert.equal(await background.webContents.executeJavaScript('window.clicks'), 1, 'baseline native input must reach the QA target');
    win = createPillWindow({ autoShow: false });
    await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
    win.setBounds({ x: 300, y: 240, width: 280, height: 102 });
    win.webContents.send('pill:state', { agents: [{ agent: 'claude', state: 'idle', status: 'ok', percent: 42 }] });
    win.showInactive();
    const evaluate = code => win.webContents.executeJavaScript(code);
    const rect = () => evaluate(`(() => {const r=document.getElementById('pill').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`);
    await mouse({ x: 220, y: 400 });
    await pause(700);
    const collapsed = await rect();
    assert.ok(Math.abs(collapsed.width - 84) < 0.1, 'one-agent collapsed width');
    await win.capturePage().then(img => fs.writeFileSync(path.join(artifacts, 'native-collapsed.png'), img.toPNG()));
    const margin = { x: 325, y: 305 };
    await mouse(margin);
    await pause(350);
    await mouse(margin, 'click');
    await pause(200);
    assert.equal(await background.webContents.executeJavaScript('window.clicks'), 2, 'collapsed margin must click the window underneath');
    const center = { x: 440, y: 260 };
    await mouse(center);
    await pause(750);
    const expanded = await rect();
    assert.ok(Math.abs(expanded.width - 248) < 0.1,
      `native hover expands the pill: ${JSON.stringify({ expanded, cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() })}`);
    await win.capturePage().then(img => fs.writeFileSync(path.join(artifacts, 'native-expanded.png'), img.toPNG()));
    await mouse({ x: 440, y: 305 });
    await pause(350);
    await mouse({ x: 440, y: 305 }, 'click');
    await pause(200);
    assert.equal(await background.webContents.executeJavaScript('window.clicks'), 3, 'one-row expanded margin must click the window underneath');
    await mouse(center);
    await pause(750);
    const badge = await evaluate(`(() => {const r=document.querySelector('.badge').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await mouse({ x: 300 + badge.x, y: 240 + badge.y });
    await pause(350);
    await mouse({ x: 300 + badge.x, y: 240 + badge.y }, 'click');
    await pause(250);
    assert.match(await evaluate("document.getElementById('detail').textContent"), /Idle/);
    console.log('PASS native collapsed margin click-through, hover expansion, badge inspection');
    await evaluate("window.dispatchEvent(new Event('blur'))");
    await mouse({ x: 220, y: 400 });
    await pause(750);
    await mouse(center);
    await pause(750);
    const handle = await evaluate(`(() => {const r=document.querySelector('.bar-track').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    const grab = { x: 300 + handle.x, y: 240 + handle.y };
    await mouse(grab, 'drag');
    await pause(350);
    assert.ok(win.getBounds().x > 330, 'native pill drag changes window position');
    console.log('PASS native drag and drop');
  } catch (error) {
    console.error(error);
    exitCode = 1;
  } finally {
    await mouse(originalCursor).catch(() => {});
    app.exit(exitCode);
  }
});
