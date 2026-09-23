'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
for (const flag of ['disable-background-timer-throttling', 'disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(flag);
app.whenReady().then(async () => {
  const win = new BrowserWindow({width: 280, height: 102, frame: false, show: false,
    webPreferences: {preload: path.join(__dirname, '../src/preload.js'), backgroundThrottling: false, offscreen: true}});
  const evaluate = code => win.webContents.executeJavaScript(code);
  const hover = async expanded => {
    await evaluate(`window.hoverChanged = new Promise(resolve => {
      const pill = document.getElementById('pill');
      if (pill.classList.contains('expanded') === ${expanded}) return resolve();
      const observer = new MutationObserver(() => {
        if (pill.classList.contains('expanded') === ${expanded}) {observer.disconnect(); resolve();}
      });
      observer.observe(pill, {attributes: true});
    }); void 0`);
    win.webContents.send('pill:hover', expanded);
    await evaluate('window.hoverChanged');
  };
  const transition = () => evaluate(`(() => {
    const pill = document.getElementById('pill');
    const animations = pill.getAnimations({subtree: true}).filter(a => a instanceof CSSTransition);
    animations.forEach(a => a.pause());
    const frames = [];
    // Seek the real CSS transitions so even a slow CI machine samples every step.
    for (let ms = 0; ms <= 450; ms += 10) {
      animations.forEach(a => {a.currentTime = ms;});
      const r = pill.getBoundingClientRect();
      frames.push({height: r.height, width: r.width, top: r.top, center: r.x + r.width / 2});
    }
    animations.forEach(a => a.finish());
    return frames;
  })()`);
  const check = (frames, start, end, label) => {
    for (const [i, frame] of frames.entries()) {
      assert.ok(Math.abs(frame.top - 6) < 0.1, `${label}: top shifted`);
      assert.ok(Math.abs(frame.center - frames[0].center) < 0.1, `${label}: center shifted`);
      for (const key of ['height', 'width']) {
        assert.ok(frame[key] <= Math.max(start[key], end[key]) + 0.1,
          `${label}: ${key} spike ${frame[key]}`);
        assert.ok(frame[key] >= Math.min(start[key], end[key]) - 0.1, `${label}: ${key} undershoot`);
        if (i) {
          const delta = frame[key] - frames[i-1][key];
          assert.ok(delta * Math.sign(end[key] - start[key]) >= -0.1, `${label}: ${key} reversed`);
          assert.ok(Math.abs(delta) <= Math.abs(end[key] - start[key]) * 0.2 + 0.1,
            `${label}: ${key} jumped instead of interpolating`);
        }
      }
    }
    for (const key of ['height', 'width']) assert.ok(Math.abs(frames.at(-1)[key] - end[key]) < 0.1, `${label}: final ${key}`);
  };
  try {
    const agent = {agent: 'claude', state: 'working', percent: 42, status: 'ok'};
    const cases = [
      {name: 'one agent', agents: [agent], height: 50},
      {name: 'one detail line', agents: [{...agent, weeklyPercent: 18, planType: 'Pro'}], height: 64},
      {name: 'wrapped detail', agents: [{...agent, status: 'stale', weeklyPercent: 18, planType: 'Pro'}], height: 78},
      {name: 'two agents', agents: [agent, {...agent, agent: 'codex', percent: 63}], height: 74},
    ];
    for (const [width, height] of [[280, 102], [360, 180], [800, 600]]) {
      win.setContentSize(width, height);
      for (const scenario of cases) {
        await win.loadFile(path.join(__dirname, '../src/renderer/index.html'));
        win.webContents.send('pill:state', {agents: scenario.agents});
        await evaluate(`new Promise(resolve => {
          function frame() {
            if (document.querySelectorAll('.agent-row').length === ${scenario.agents.length}) resolve();
            else requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        })`);
        await evaluate(`document.getAnimations().filter(a => a.animationName === 'pillAppear').forEach(a => a.finish())`);
        await transition();
        const compact = {height: 36, width: scenario.agents.length === 2 ? 104 : 84};
        const expanded = {width: 248, height: scenario.height};
        const label = `${width}x${height} ${scenario.name}`;
        for (let cycle = 0; cycle < 3; cycle++) {
          await hover(true);
          check(await transition(), compact, expanded, `${label} expand`);
          await hover(false);
          check(await transition(), expanded, compact, `${label} collapse`);
        }
        // Reverse running transitions before completion, as rapid enter/leave does.
        for (const desired of [true, false, true, false, true]) {
          await hover(desired);
          await evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
          const current = await evaluate(`document.getElementById('pill').getBoundingClientRect().height`);
          assert.ok(current >= 35.9 && current <= expanded.height + 0.1, `${label}: reversal height`);
        }
        await transition();
        await hover(false);
        check(await transition(), expanded, compact, `${label} final collapse`);
        console.log(`PASS ${label}: ${expanded.height}px -> 36px; 3 cycles and rapid reversals`);
      }
    }
    app.exit(0);
  } catch (error) {console.error(error); app.exit(1);}
});
