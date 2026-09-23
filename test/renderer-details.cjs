'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 280, height: 102, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, '../src/preload.js'), offscreen: true } });
  const evaluate = code => win.webContents.executeJavaScript(code);
  const settle = () => evaluate('new Promise(resolve => setTimeout(resolve, 500))');
  // Confirms the real preload bridge (not a mock) actually carries pill.js's
  // updateExpansion() calls to the main process as 'pill:expanded' -- the
  // wiring placement.js's own tests only exercise from the main side with a
  // synthetic ipc-message emit.
  const expandedLog = [];
  win.webContents.on('ipc-message', (_event, channel, value) => {
    if (channel === 'pill:expanded') expandedLog.push(value);
  });
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
    assert.equal(expandedLog.at(-1), true);
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
    // Keyboard inspection must keep main's isExpanded true even though hover
    // just went false -- otherwise placement.js would clamp/hit-test against
    // the collapsed rect while the card is still visibly expanded.
    assert.equal(expandedLog.at(-1), true);
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
    assert.equal(expandedLog.at(-1), false);
    // README: "focus another window to close the details" -- losing window
    // focus (e.g. alt-tabbing away) must close inspection same as Escape.
    win.webContents.send('pill:inspect');
    await settle();
    assert.equal(await evaluate("document.getElementById('pill').classList.contains('expanded')"), true);
    await evaluate("window.dispatchEvent(new Event('blur'))");
    await settle();
    assert.equal(await evaluate("document.getElementById('pill').classList.contains('expanded')"), false);
    assert.equal(expandedLog.at(-1), false);
    win.webContents.send('pill:state', { agents: [{ agent: 'codex', state: 'idle', status: 'error', percent: 40 }] });
    await settle();
    assert.equal(await evaluate("document.querySelector('.freshness').textContent"), 'unavailable');
    win.webContents.send('pill:state', { agents });
    await settle();
    await evaluate("document.querySelectorAll('.badge')[1].click()");
    await evaluate("document.querySelectorAll('.badge')[1].click()");
    await settle();
    assert.equal(await evaluate("document.querySelectorAll('.agent-row:not([hidden])').length"), 2);
    win.webContents.send('pill:state', { agents: [{ agent: 'claude', state: 'idle', status: 'pending', percent: null }] });
    await settle();
    assert.equal(await evaluate("document.querySelector('.percent').textContent"), '—');
    assert.equal(await evaluate("document.querySelector('.percent').classList.contains('percent-status')"), false);
    assert.equal(await evaluate("document.getElementById('detail').textContent"), '');
    // A live state update (e.g. a usage percent tick) must not steal focus
    // away from a visible, still-focused non-badge control (Back, or the
    // scrollable detail text) -- regression: an earlier fix conflated
    // "still focused" with "is a still-shown agent badge".
    win.webContents.send('pill:state', { agents });
    win.webContents.send('pill:inspect');
    await settle();
    await evaluate("document.querySelectorAll('.badge')[1].click()");
    await settle();
    await evaluate("document.getElementById('backToAgents').focus()");
    win.webContents.send('pill:state', { agents: [agents[0], { ...agents[1], percent: 41 }] });
    await settle();
    assert.equal(await evaluate("document.activeElement.id"), 'backToAgents');
    await evaluate("document.getElementById('detail').focus()");
    win.webContents.send('pill:state', { agents: [agents[0], { ...agents[1], percent: 42 }] });
    await settle();
    assert.equal(await evaluate("document.activeElement.id"), 'detail');
    win.webContents.send('pill:state', { agents: [] });
    await settle();
    assert.match(await evaluate("document.querySelector('.badge').getAttribute('aria-label')"), /No active agent/);
    console.log('PASS stale values, approval, details, selection removal, keyboard inspection, Escape, window blur, error freshness label, reselect toggle, pending placeholder, pill:expanded IPC wiring, no-active-agent placeholder');
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
