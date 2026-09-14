'use strict';

/**
 * USAGE_PILL_MOCK=1 driver: steps the renderer through every state and
 * threshold without waiting on real usage or real agent activity. This is
 * how the animations get tuned (per the build order, built before the real
 * data layer) and it stays available afterward for quick visual checks.
 */
const SCRIPT = [
  { agent: 'claude', percent: 3, weeklyPercent: 12, planType: null, state: 'idle', status: 'ok', holdMs: 1500 },
  { agent: 'claude', percent: 3, weeklyPercent: 12, planType: null, state: 'working', status: 'ok', holdMs: 2500 },
  { agent: 'claude', percent: 8, weeklyPercent: 18, planType: null, state: 'working', status: 'ok', holdMs: 1800 },
  { agent: 'claude', percent: 8, weeklyPercent: 18, planType: null, state: 'blocked', status: 'ok', holdMs: 2000 },
  { agent: 'claude', percent: 8, weeklyPercent: 18, planType: null, state: 'working', status: 'ok', holdMs: 1500 },
  { agent: 'claude', percent: 22, weeklyPercent: 63, planType: null, state: 'idle', status: 'ok', holdMs: 1500 },
  // agent switch, crossfade
  { agent: 'codex', percent: 10, weeklyPercent: 2, planType: 'plus', state: 'idle', status: 'ok', holdMs: 1500 },
  { agent: 'codex', percent: 10, weeklyPercent: 2, planType: 'plus', state: 'working', status: 'ok', holdMs: 2500 },
  { agent: 'codex', percent: 45, weeklyPercent: 30, planType: 'plus', state: 'working', status: 'ok', holdMs: 1800 },
  // amber threshold
  { agent: 'codex', percent: 78, weeklyPercent: 60, planType: 'plus', state: 'idle', status: 'ok', holdMs: 1800 },
  // red threshold + pulse
  { agent: 'codex', percent: 93, weeklyPercent: 88, planType: 'plus', state: 'working', status: 'ok', holdMs: 2200 },
  { agent: 'codex', percent: 93, weeklyPercent: 88, planType: 'plus', state: 'idle', status: 'ok', holdMs: 1800 },
  // back to claude, error states
  { agent: 'claude', percent: null, weeklyPercent: null, planType: null, state: 'idle', status: 'unauthenticated', holdMs: 1800 },
  { agent: 'claude', percent: 3, weeklyPercent: 63, planType: null, resetsAtInMs: 3600_000, state: 'idle', status: 'stale', holdMs: 1800 },
  { agent: null, percent: null, weeklyPercent: null, planType: null, state: 'idle', status: 'never-used', holdMs: 1500 },
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
    const resetsAt = frame.resetsAtInMs ? new Date(Date.now() + frame.resetsAtInMs).toISOString() : null;
    this._onChange({
      agent: frame.agent,
      percent: frame.percent,
      resetsAt,
      weeklyPercent: frame.weeklyPercent,
      planType: frame.planType,
      state: frame.state,
      status: frame.status,
    });
    this._timer = setTimeout(() => this._step(), frame.holdMs);
  }
}

module.exports = { MockDriver };
