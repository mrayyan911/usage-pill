'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { SessionStore } = require('../src/main/stores/sessions');
const { reduce } = require('../src/main/reduce');
const { EMPTY_USAGE } = require('../src/main/usageShape');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 280, height: 110, frame: false, transparent: true, show: false, webPreferences: {
    preload: path.join(__dirname, '../src/preload.js'), offscreen: true,
  }});
  try {
    const live = process.argv.includes('--live');
    const store = new SessionStore(live ? {} : { readProcesses: async () => require('./fixtures/codex-windows-processes.json') });
    await store.poll();
    assert(store.getSnapshot().agents.includes('codex'), 'live Codex session must be discovered');
    const state = reduce({ sessionAgents: store.getSnapshot().agents,
      activitySnapshot: { active: null, claude: 'idle', codex: 'idle' },
      claudeUsage: { ...EMPTY_USAGE, status: 'error' },
      codexUsage: { ...EMPTY_USAGE, status: 'error' },
    });
    await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
    win.webContents.send('pill:state', state);
    const rendered = await win.webContents.executeJavaScript(`new Promise(resolve => {
      const read = () => {
        const icon = document.querySelector('.badge-icon[data-agent="codex"]');
        if (!icon) return requestAnimationFrame(read);
        resolve({ agent: icon.dataset.agent, text: icon.closest('.agent-row').querySelector('.percent').textContent });
      }; read();
    })`);
    console.log(JSON.stringify({ sessions: store.getSnapshot(), rendered }));
    assert.equal(rendered.text.trim().toLowerCase(), 'unavailable', 'an open Codex session with missing usage must render "unavailable", not OFFLINE');
    if (live) {
      const { ActivityStore } = require('../src/main/stores/activity');
      const { readCodexSnapshot } = require('../src/main/providers/codex');
      const usage = readCodexSnapshot().usage;
      assert.equal(usage.status, 'ok');
      const actual = reduce({ sessionAgents: store.getSnapshot().agents,
        activitySnapshot: new ActivityStore().poll(), claudeUsage: { ...EMPTY_USAGE, status: 'error' }, codexUsage: usage });
      win.webContents.send('pill:state', actual);
      win.webContents.send('pill:hover', true);
      await win.webContents.executeJavaScript(`new Promise(resolve => {
        const check = () => {
          if (document.querySelector('.percent').textContent !== ${JSON.stringify(Math.round(usage.percent) + '%')}) return requestAnimationFrame(check);
          setTimeout(resolve, 500);
        }; check();
      })`);
      const screenshot = path.join(require('node:os').tmpdir(), 'usage-pill-codex-verified.png');
      require('node:fs').writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      console.log(JSON.stringify({ actual, screenshot }));
    }
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
