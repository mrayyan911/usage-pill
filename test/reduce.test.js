'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reduce, Reducer } = require('../src/main/reduce');

test('reduce: neither agent ever used -> single neutral placeholder row', () => {
  const result = reduce({
    activitySnapshot: { active: null, claude: 'idle', codex: 'idle' },
    claudeUsage: { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' },
    codexUsage: { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' },
  });
  assert.equal(result.primary, null);
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].agent, null);
  assert.equal(result.agents[0].status, 'never-used');
});

test('reduce: active claude, working, codex idle -> single claude row', () => {
  const resetsAt = new Date('2026-09-14T10:00:00.000Z');
  const result = reduce({
    activitySnapshot: { active: 'claude', claude: 'working', codex: 'idle' },
    claudeUsage: { percent: 3, resetsAt, weeklyPercent: 63, planType: null, status: 'ok' },
    codexUsage: { percent: 10, resetsAt: null, weeklyPercent: 2, planType: 'plus', status: 'ok' },
  });
  assert.equal(result.primary, 'claude');
  assert.equal(result.agents.length, 1);
  const [row] = result.agents;
  assert.equal(row.agent, 'claude');
  assert.equal(row.percent, 3);
  assert.equal(row.weeklyPercent, 63);
  assert.equal(row.state, 'working');
  assert.equal(row.resetsAt, resetsAt.toISOString());
});

test('reduce: active codex, idle claude -> single codex row uses codex usage, not claude', () => {
  const result = reduce({
    activitySnapshot: { active: 'codex', claude: 'idle', codex: 'blocked' },
    claudeUsage: { percent: 3, resetsAt: null, weeklyPercent: 63, planType: null, status: 'ok' },
    codexUsage: { percent: 10, resetsAt: null, weeklyPercent: 2, planType: 'plus', status: 'ok' },
  });
  assert.equal(result.primary, 'codex');
  assert.equal(result.agents.length, 1);
  const [row] = result.agents;
  assert.equal(row.agent, 'codex');
  assert.equal(row.percent, 10);
  assert.equal(row.planType, 'plus');
  assert.equal(row.state, 'blocked');
});

test('reduce: both agents busy at once -> two rows, primary (mtime winner) first', () => {
  const result = reduce({
    activitySnapshot: { active: 'codex', claude: 'working', codex: 'blocked' },
    claudeUsage: { percent: 22, resetsAt: null, weeklyPercent: 40, planType: null, status: 'ok' },
    codexUsage: { percent: 78, resetsAt: null, weeklyPercent: 60, planType: 'plus', status: 'ok' },
  });
  assert.equal(result.primary, 'codex');
  assert.equal(result.agents.length, 2);
  assert.deepEqual(
    result.agents.map((a) => a.agent),
    ['codex', 'claude'],
  );
  assert.equal(result.agents[0].percent, 78);
  assert.equal(result.agents[1].percent, 22);
});

test('reduce: only one agent busy even if the other has stored usage -> single row', () => {
  const result = reduce({
    activitySnapshot: { active: 'claude', claude: 'working', codex: 'idle' },
    claudeUsage: { percent: 5, resetsAt: null, weeklyPercent: null, planType: null, status: 'ok' },
    codexUsage: { percent: 45, resetsAt: null, weeklyPercent: null, planType: 'plus', status: 'ok' },
  });
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].agent, 'claude');
});

test('Reducer: only calls onChange when the reduced state actually changes', () => {
  let calls = 0;
  let lastState = null;
  const activityStore = { poll: () => ({ active: 'claude', claude: 'idle', codex: 'idle' }) };
  const usageStore = {
    maybeRefreshClaude: () => {},
    refreshCodex: () => {},
    getClaudeUsage: () => ({ percent: 5, resetsAt: null, weeklyPercent: 10, planType: null, status: 'ok' }),
    getCodexUsage: () => ({ percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' }),
  };
  const reducer = new Reducer({
    activityStore,
    usageStore,
    onChange: (s) => {
      calls += 1;
      lastState = s;
    },
    tickMs: 1_000_000, // never auto-fires; we call _tick manually
  });

  reducer._tick();
  reducer._tick();
  reducer._tick();
  assert.equal(calls, 1, 'identical successive ticks should only notify once');
  assert.equal(lastState.agents[0].percent, 5);
});

test('Reducer: detects a working->idle edge exactly once per transition', () => {
  const states = ['working', 'working', 'idle', 'idle', 'working', 'idle'];
  let i = 0;
  const edges = [];
  const activityStore = { poll: () => ({ active: 'claude', claude: states[i++], codex: 'idle' }) };
  const usageStore = {
    maybeRefreshClaude: (edge) => edges.push(edge),
    refreshCodex: () => {},
    getClaudeUsage: () => ({ percent: 1, resetsAt: null, weeklyPercent: null, planType: null, status: 'ok' }),
    getCodexUsage: () => ({ percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' }),
  };
  const reducer = new Reducer({ activityStore, usageStore, onChange: () => {}, tickMs: 1_000_000 });
  for (let n = 0; n < states.length; n++) reducer._tick();
  assert.deepEqual(edges, [false, false, true, false, false, true]);
});

test('reduce: every dual busy combination preserves ordering and independent usage errors', () => {
  const claudeUsage = { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'unauthenticated' };
  const codexUsage = { percent: 0, resetsAt: '2026-09-14T10:00:00.000Z', weeklyPercent: 100, planType: 'plus', status: 'stale' };
  for (const active of ['claude', 'codex']) {
    for (const claude of ['working', 'blocked']) {
      for (const codex of ['working', 'blocked']) {
        const result = reduce({ activitySnapshot: { active, claude, codex }, claudeUsage, codexUsage });
        assert.equal(result.primary, active);
        assert.deepEqual(result.agents.map(row => row.agent), active === 'claude' ? ['claude', 'codex'] : ['codex', 'claude']);
        assert.deepEqual(result.agents.find(row => row.agent === 'claude'), { agent: 'claude', ...claudeUsage, state: claude });
        assert.deepEqual(result.agents.find(row => row.agent === 'codex'), { agent: 'codex', ...codexUsage, state: codex });
      }
    }
  }
});

test('Reducer: secondary updates publish, then blocked Claude completion refreshes and removes its row', () => {
  let snapshot = { active: 'codex', claude: 'blocked', codex: 'working' };
  let claudePercent = 10;
  const notifications = [];
  const edges = [];
  const reducer = new Reducer({
    activityStore: { poll: () => snapshot },
    usageStore: {
      maybeRefreshClaude: edge => edges.push(edge),
      refreshCodex: () => {},
      getClaudeUsage: () => ({ percent: claudePercent, resetsAt: null, weeklyPercent: null, planType: null, status: 'ok' }),
      getCodexUsage: () => ({ percent: 50, resetsAt: null, weeklyPercent: null, planType: 'plus', status: 'ok' }),
    },
    onChange: state => notifications.push(state),
  });
  reducer._tick();
  claudePercent = 20;
  reducer._tick();
  reducer._tick();
  snapshot = { active: 'codex', claude: 'idle', codex: 'working' };
  reducer._tick();
  reducer._tick();
  assert.deepEqual(edges, [false, false, false, true, false]);
  assert.equal(notifications.length, 3);
  assert.equal(notifications[1].agents[1].percent, 20);
  assert.deepEqual(notifications[2].agents.map(row => row.agent), ['codex']);
});
