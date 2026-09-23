'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 280, height: 102, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), offscreen: true } });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 500))');
  const agents = [
    { agent: 'claude', state: 'blocked', status: 'stale', percent: 60, weeklyPercent: 72 },
    { agent: 'codex', state: 'working', status: 'ok', percent: 40, weeklyPercent: 91, planType: 'plus' },
  ];
  try {
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    win.webContents.send('pill:state', { agents });
    win.webContents.send('pill:hover', true);
    await settle();
    assert.equal(await evaluate("document.querySelector('.percent').textContent"), '60%');
    assert.equal(await evaluate("document.querySelector('.freshness').textContent"), 'stale');
    assert.match(await evaluate("document.querySelector('.badge').getAttribute('aria-label')"), /approval/i);
    assert.equal(await evaluate("document.querySelector('.collapsed.blocked') !== null"), true);
    await evaluate("document.querySelectorAll('.badge')[1].click()");
    await settle();
    assert.match(await evaluate("document.getElementById('detail').textContent"), /weekly 91%/);
    assert.ok(await evaluate("document.getElementById('pill').getBoundingClientRect().height <= 78.1"));
    await evaluate("document.getElementById('backToAgents').click()");
    assert.equal(await evaluate("document.querySelectorAll('.agent-row:not([hidden])').length"), 2);
    win.webContents.send('pill:inspect');
    await settle();
    assert.equal(await evaluate("document.activeElement.classList.contains('badge')"), true);
    win.webContents.send('pill:hover', false);
    await settle();
    assert.equal(await evaluate("document.getElementById('pill').classList.contains('expanded')"), true);
    await evaluate("document.activeElement.click()");
    assert.match(await evaluate("document.getElementById('detail').textContent"), /approval/i);
    await evaluate("document.getElementById('backToAgents').focus()");
    win.webContents.send('pill:state', { agents: [agents[1]] });
    await settle();
    assert.match(await evaluate("document.getElementById('detail').textContent"), /weekly 91%/);
    assert.equal(await evaluate("document.activeElement.classList.contains('badge')"), true);
    win.webContents.send('pill:state', { agents });
    await settle();
    await evaluate("document.querySelectorAll('.badge')[1].focus()");
    win.webContents.send('pill:state', { agents: [...agents].reverse() });
    await settle();
    assert.equal(await evaluate("document.activeElement.querySelector('[data-agent]')?.dataset.agent"), 'codex');
    await evaluate("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))");
    await settle();
    assert.equal(await evaluate("document.getElementById('pill').classList.contains('expanded')"), false);
    win.webContents.send('pill:state', { agents: [{ agent: 'codex', state: 'idle', status: 'error', percent: 40 }] });
    await settle();
    assert.equal(await evaluate("document.querySelector('.freshness').textContent"), 'unavailable');
    console.log('PASS stale values, approval, details, selection removal, keyboard inspection, Escape, error freshness label');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
