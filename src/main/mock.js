'use strict';

/**
 * USAGE_PILL_MOCK=1 driver: steps the renderer through every state and
 * threshold without waiting on real usage or real agent activity. This is
 * how the animations get tuned (per the build order, built before the real
 * data layer) and it stays available afterward for quick visual checks.
 *
 * Each frame's `agents` array mirrors what `reduce()` sends over IPC: one
 * row normally, two when both agents are meant to be busy at once (the
 * only condition the two-row expanded view exists for).
 */
const SCRIPT = [
  { agents: [{ agent: 'claude', percent: 3, weeklyPercent: 12, planType: null, state: 'idle', status: 'ok' }], holdMs: 1500 },
  { agents: [{ agent: 'claude', percent: 3, weeklyPercent: 12, planType: null, state: 'working', status: 'ok' }], holdMs: 2500 },
  { agents: [{ agent: 'claude', percent: 8, weeklyPercent: 18, planType: null, state: 'working', status: 'ok' }], holdMs: 1800 },
  { agents: [{ agent: 'claude', percent: 8, weeklyPercent: 18, planType: null, state: 'blocked', status: 'ok' }], holdMs: 2000 },
  { agents: [{ agent: 'claude', percent: 8, weeklyPercent: 18, planType: null, state: 'working', status: 'ok' }], holdMs: 1500 },
  { agents: [{ agent: 'claude', percent: 22, weeklyPercent: 63, planType: null, state: 'idle', status: 'ok' }], holdMs: 1500 },
  // both agents busy at once -- the two-row expanded view
  {
    agents: [
      { agent: 'claude', percent: 22, weeklyPercent: 63, planType: null, state: 'working', status: 'ok' },
      { agent: 'codex', percent: 45, weeklyPercent: 30, planType: 'plus', state: 'working', status: 'ok' },
    ],
    holdMs: 3000,
  },
  {
    agents: [
      { agent: 'codex', percent: 78, weeklyPercent: 60, planType: 'plus', state: 'blocked', status: 'ok' },
      { agent: 'claude', percent: 22, weeklyPercent: 63, planType: null, state: 'working', status: 'ok' },
    ],
    holdMs: 2400,
  },
  // one drops back to idle -- collapses back to a single row
  { agents: [{ agent: 'codex', percent: 10, weeklyPercent: 2, planType: 'plus', state: 'idle', status: 'ok' }], holdMs: 1500 },
  { agents: [{ agent: 'codex', percent: 10, weeklyPercent: 2, planType: 'plus', state: 'working', status: 'ok' }], holdMs: 2500 },
  { agents: [{ agent: 'codex', percent: 45, weeklyPercent: 30, planType: 'plus', state: 'working', status: 'ok' }], holdMs: 1800 },
  // amber threshold
  { agents: [{ agent: 'codex', percent: 78, weeklyPercent: 60, planType: 'plus', state: 'idle', status: 'ok' }], holdMs: 1800 },
  // red threshold + danger pulse, both agents busy and one in the red
  {
    agents: [
      { agent: 'codex', percent: 93, weeklyPercent: 88, planType: 'plus', state: 'working', status: 'ok' },
      { agent: 'claude', percent: 34, weeklyPercent: 50, planType: null, state: 'working', status: 'ok' },
    ],
    holdMs: 2600,
  },
  { agents: [{ agent: 'codex', percent: 93, weeklyPercent: 88, planType: 'plus', state: 'idle', status: 'ok' }], holdMs: 1800 },
  // back to claude, error states
  { agents: [{ agent: 'claude', percent: null, weeklyPercent: null, planType: null, state: 'idle', status: 'unauthenticated' }], holdMs: 1800 },
  {
    agents: [{ agent: 'claude', percent: 3, weeklyPercent: 63, planType: null, resetsAtInMs: 3600_000, state: 'idle', status: 'stale' }],
    holdMs: 1800,
  },
  { agents: [{ agent: null, percent: null, weeklyPercent: null, planType: null, state: 'idle', status: 'never-used' }], holdMs: 1500 },
];

class MockDriver {
  constructor({ onChange }) {
    this._onChange = onChange;
    this._i = 0;
    this._timer = null;
  }

  start() {
    this._step();
  }

  stop() {
    if (this._timer) clearTimeout(this._timer);
  }

  _step() {
    const frame = SCRIPT[this._i % SCRIPT.length];
    this._i += 1;
    const agents = frame.agents.map((row) => ({
      agent: row.agent,
      percent: row.percent,
      resetsAt: row.resetsAtInMs ? new Date(Date.now() + row.resetsAtInMs).toISOString() : null,
      weeklyPercent: row.weeklyPercent,
      planType: row.planType,
      state: row.state,
      status: row.status,
    }));
    this._onChange({ agents, primary: agents.length ? agents[0].agent : null });
    this._timer = setTimeout(() => this._step(), frame.holdMs);
  }
}

module.exports = { MockDriver };
