'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reduce, Reducer } = require('../src/main/reduce');

test('reduce: neither agent ever used -> placeholder', () => {
  const result = reduce({
    activitySnapshot: { active: null, claude: 'idle', codex: 'idle' },
    claudeUsage: { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' },
    codexUsage: { percent: null, resetsAt: null, weeklyPercent: null, planType: null, status: 'error' },
  });
  assert.equal(result.agent, null);
  assert.equal(result.status, 'never-used');
});

test('reduce: active claude, working -> carries claude usage + working state', () => {
  const resetsAt = new Date('2026-09-14T10:00:00.000Z');
  const result = reduce({
    activitySnapshot: { active: 'claude', claude: 'working', codex: 'idle' },
    claudeUsage: { percent: 3, resetsAt, weeklyPercent: 63, planType: null, status: 'ok' },
    codexUsage: { percent: 10, resetsAt: null, weeklyPercent: 2, planType: 'plus', status: 'ok' },
  });
  assert.equal(result.agent, 'claude');
  assert.equal(result.percent, 3);
  assert.equal(result.weeklyPercent, 63);
  assert.equal(result.state, 'working');
  assert.equal(result.resetsAt, resetsAt.toISOString());
});

test('reduce: active codex uses codex usage, not claude', () => {
  const result = reduce({
    activitySnapshot: { active: 'codex', claude: 'idle', codex: 'blocked' },
    claudeUsage: { percent: 3, resetsAt: null, weeklyPercent: 63, planType: null, status: 'ok' },
    codexUsage: { percent: 10, resetsAt: null, weeklyPercent: 2, planType: 'plus', status: 'ok' },
  });
  assert.equal(result.agent, 'codex');
  assert.equal(result.percent, 10);
  assert.equal(result.planType, 'plus');
  assert.equal(result.state, 'blocked');
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
  assert.equal(lastState.percent, 5);
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
